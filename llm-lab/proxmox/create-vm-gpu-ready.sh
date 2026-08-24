#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Create a VM prepared for GPU PCIe passthrough. RUN ON THE PROXMOX HOST.
#
# A VM (not LXC) is the right choice here specifically because PCIe passthrough
# is cleaner with VFIO than with container device cgroups. Everywhere else in
# this kit, LXC wins -- see docs/01-architecture.md.
#
#   ./create-vm-gpu-ready.sh --vmid 300 --ip 10.0.0.207/24 --pci 01:00
#
# Omit --pci to create the VM and print the passthrough steps without attaching
# anything -- useful for preparing the host before the card arrives.
# ---------------------------------------------------------------------------
set -euo pipefail

VMID=""; IPADDR=""; GATEWAY=""; PCI=""; VM_NAME="llm-gpu"
BRIDGE="vmbr0"; MEMORY=32768; CORES=0; DISK=200; STORAGE="local-lvm"

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vmid)    VMID="$2"; shift 2 ;;
    --ip)      IPADDR="$2"; shift 2 ;;
    --gw)      GATEWAY="$2"; shift 2 ;;
    --pci)     PCI="$2"; shift 2 ;;
    --name)    VM_NAME="$2"; shift 2 ;;
    --memory)  MEMORY="$2"; shift 2 ;;
    --cores)   CORES="$2"; shift 2 ;;
    --disk)    DISK="$2"; shift 2 ;;
    --storage) STORAGE="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$VMID" ]] || die "--vmid is required"
command -v qm >/dev/null || die "qm not found -- run this on the Proxmox host"
[[ $EUID -eq 0 ]] || die "must run as root"
qm status "$VMID" >/dev/null 2>&1 && die "VMID $VMID already exists"

if [[ "$CORES" -eq 0 ]]; then
  sockets=$(lscpu | awk -F: '/^Socket\(s\)/ {gsub(/ /,"",$2); print $2}')
  per_socket=$(lscpu | awk -F: '/^Core\(s\) per socket/ {gsub(/ /,"",$2); print $2}')
  CORES=$(( ${sockets:-1} * ${per_socket:-4} ))
fi

# --- Host IOMMU prerequisites --------------------------------------------
echo "==> checking host IOMMU support"
if ! dmesg 2>/dev/null | grep -qiE 'DMAR: IOMMU enabled|AMD-Vi: Interrupt remapping enabled'; then
  cat >&2 <<'WARN'
warning: IOMMU does not appear to be enabled on this host. PCIe passthrough
         will not work until it is. On an Intel host:

  1. Enable VT-d (and "Above 4G Decoding" / "Resizable BAR" if present) in BIOS.
  2. Add to the kernel command line:
       intel_iommu=on iommu=pt
     GRUB:            /etc/default/grub -> GRUB_CMDLINE_LINUX_DEFAULT, update-grub
     systemd-boot:    /etc/kernel/cmdline, then proxmox-boot-tool refresh
  3. Load the VFIO modules in /etc/modules:
       vfio vfio_iommu_type1 vfio_pci
  4. Reboot, then re-run this script.

Continuing to create the VM without the passthrough device.
WARN
fi

echo "==> creating VM $VMID ($VM_NAME): ${CORES} cores, ${MEMORY} MiB, ${DISK} GB"

# cpu=host is MANDATORY, not cosmetic: the default kvm64 model hides AVX2 and
# AVX-512 from the guest, which roughly halves prompt-processing speed. This is
# the single most common reason a VM benchmarks worse than a container.
qm create "$VMID" \
  --name "$VM_NAME" \
  --cores "$CORES" \
  --cpu host \
  --memory "$MEMORY" \
  --balloon 0 \
  --numa 1 \
  --ostype l26 \
  --machine q35 \
  --bios ovmf \
  --efidisk0 "${STORAGE}:1,efitype=4m,pre-enrolled-keys=0" \
  --scsihw virtio-scsi-single \
  --scsi0 "${STORAGE}:${DISK},iothread=1,discard=on,ssd=1" \
  --net0 "virtio,bridge=${BRIDGE}" \
  --agent enabled=1 \
  --onboot 1 \
  --tags "llm;gpu;inference" \
  --description "GPU inference node -- managed by llm-lab, see docs/04-gpu-upgrade-path.md"

# q35 + OVMF is required for modern GPU passthrough: SeaBIOS and the i440fx
# machine type do not handle large BARs or GPU reset reliably.

if [[ -n "$PCI" ]]; then
  echo "==> attaching PCI device ${PCI} with passthrough"
  # pcie=1 exposes it as a PCIe (not PCI) device, which the driver expects.
  # x-vga=1 is deliberately omitted: this is a compute GPU, not the guest's
  # display adapter, and setting it complicates host console access.
  qm set "$VMID" --hostpci0 "${PCI},pcie=1"
  echo "==> attached. Verify inside the guest with: lspci -nnk | grep -A3 -i nvidia"
else
  cat <<'NEXT'

==> No --pci given, so no device was attached. To find and attach the card:

  lspci -nn | grep -Ei 'vga|3d|display'
      -> note the address, e.g. 01:00.0, and the vendor:device IDs

  # Confirm the GPU is in its own IOMMU group. If it shares a group with other
  # devices, they must ALL be passed through together -- which is usually
  # impractical. A dedicated x16 slot almost always gets its own group; an
  # OCuLink or Thunderbolt attachment often does not.
  for g in /sys/kernel/iommu_groups/*/devices/*; do
      echo "group ${g#/sys/kernel/iommu_groups/}"
  done | sort -V

  # Blacklist the host driver so the host does not claim the card first:
  echo "blacklist nouveau"  >> /etc/modprobe.d/blacklist-gpu.conf
  echo "blacklist nvidia"   >> /etc/modprobe.d/blacklist-gpu.conf
  update-initramfs -u -k all && reboot

  # Then attach:
  qm set <VMID> --hostpci0 01:00,pcie=1

NEXT
fi

cat <<EOF

==> VM $VMID created but has no OS. Install Debian 12, then inside the guest:

  1. Install the GPU driver and CUDA toolkit for your card.

  2. Rebuild llama.cpp with GPU support -- same binary, same flags, same API:
       cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
     then add '-ngl 99' to offload all layers, and DROP --mlock and the CPU
     thread tuning: both are irrelevant once weights live in VRAM.

  3. Consider vLLM instead of llama.cpp on this node. Its continuous batching
     and paged attention give substantially better CONCURRENT throughput on
     GPU, which is exactly what live voice needs. Keep llama.cpp on the CPU
     workers; the gateway hides the difference from your applications.

  4. Add this node to gateway/litellm-config.yaml with higher routing priority
     than the CPU workers. That is the whole integration.

  5. Re-run the voice budget -- this is the change that makes live voice viable:
       make voice-check GATEWAY=http://<gateway>:4000 MODEL=workhorse

See docs/04-gpu-upgrade-path.md for card selection and what the six mini PCs
should do afterwards.
EOF
