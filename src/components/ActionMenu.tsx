import { Sheet } from './Sheet'

export interface MenuAction {
  label: string
  onSelect: () => void
  danger?: boolean
}

/**
 * A short list of actions in a bottom sheet — what the "…" buttons open.
 * Keeps secondary controls off the main screens.
 */
export function ActionMenu({
  title,
  actions,
  onClose,
}: {
  title: string
  actions: MenuAction[]
  onClose: () => void
}) {
  return (
    <Sheet open title={title} onClose={onClose}>
      <div className="stack">
        {actions.map((a) => (
          <button
            key={a.label}
            className={`menu-item${a.danger ? ' danger' : ''}`}
            onClick={() => {
              a.onSelect()
              onClose()
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
