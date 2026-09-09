import { describe, expect, it } from "vitest";
import { buildDemoJourney } from "./journey";
import { isReached, reachVerdict, summariseTranscript } from "./classify";

// ---------------------------------------------------------------------------
// The drawer's job is to justify the table. These tests pin the two ways that
// justification could quietly go wrong: a verdict that disagrees with the
// engine driving the metrics, and attempt numbers taken from provider order.
// ---------------------------------------------------------------------------

const t = (text: string) => summariseTranscript("c1", [{ role: "user", text }]);

describe("reachVerdict", () => {
  it("never disagrees with isReached", () => {
    const cases = [
      { durationSeconds: 0, transcript: null },
      { durationSeconds: 42, transcript: null },
      { durationSeconds: 12, transcript: summariseTranscript("c1", [{ role: "assistant", text: "Hello?" }]) },
      { durationSeconds: 9, transcript: t("The subscriber you have dialled is not available") },
      { durationSeconds: 15, transcript: t("yes okay") },
      { durationSeconds: 90, transcript: t("Yes speaking, I can pay fifteen hundred rand on the twenty fifth") },
      {
        durationSeconds: 60,
        transcript: t(
          "I am not available during the day but you can reach me after five and I will make a payment then",
        ),
      },
    ];
    for (const call of cases) {
      const verdict = reachVerdict(call);
      const engine = call.transcript ? isReached(call.transcript) : false;
      expect(verdict.reached, `disagreed on: ${call.transcript?.userText ?? "no transcript"}`).toBe(engine);
      expect(verdict.reason.length).toBeGreaterThan(10);
    }
  });

  it("distinguishes a dead call from an unfetched transcript", () => {
    expect(reachVerdict({ durationSeconds: 0, transcript: null }).reason).toMatch(/never connected/i);
    expect(reachVerdict({ durationSeconds: 30, transcript: null }).reason).toMatch(/no transcript/i);
  });

  it("quotes the machine phrase it actually matched", () => {
    const utterance = "Please leave a message after the tone";
    const verdict = reachVerdict({ durationSeconds: 6, transcript: t(utterance) });
    expect(verdict.reached).toBe(false);
    // Whichever alternative the pattern hits first, the quoted phrase must be
    // real text from the transcript — not a generic "sounded like voicemail".
    const quoted = /“([^”]+)”/.exec(verdict.reason)?.[1];
    expect(quoted).toBeDefined();
    expect(utterance.toLowerCase()).toContain(quoted!.toLowerCase());
  });

  it("counts a long utterance as a person even when it contains a machine phrase", () => {
    // 15+ words: "not available" here is the tenant talking about themselves.
    const verdict = reachVerdict({
      durationSeconds: 70,
      transcript: t(
        "I am not available during the day but you can reach me after five and I will pay then",
      ),
    });
    expect(verdict.reached).toBe(true);
  });

  it("explains the 8-word conversation floor on both sides", () => {
    expect(reachVerdict({ durationSeconds: 10, transcript: t("yes okay fine ring me back later") }).reason).toMatch(
      /under the 8-word/,
    );
    expect(
      reachVerdict({ durationSeconds: 10, transcript: t("yes okay fine please ring me back later") }).reason,
    ).toMatch(/real conversation/);
  });
});

describe("buildDemoJourney", () => {
  it("returns null for an unknown account rather than an empty shell", () => {
    expect(buildDemoJourney("ACC-does-not-exist")).toBeNull();
  });

  it("numbers attempts by time and agrees with the account bucket", () => {
    // Walk the whole fixture: every account's drawer must be self-consistent.
    let checkedMultiCall = 0;
    for (let i = 0; i < 120; i++) {
      const journey = buildDemoJourney(`ACC-${5000 + i}`);
      expect(journey).not.toBeNull();
      const j = journey!;

      expect(j.calls).toHaveLength(j.attempts);
      j.calls.forEach((call, index) => {
        expect(call.attempt).toBe(index + 1);
        if (index > 0) {
          // Sorted by time — provider order is never trusted.
          expect(call.startedAt.getTime()).toBeGreaterThanOrEqual(j.calls[index - 1].startedAt.getTime());
        }
      });
      if (j.calls.length > 1) checkedMultiCall += 1;

      // The bucket must follow from the per-call verdicts shown in the drawer.
      const anyReached = j.calls.some((c) => c.reached);
      if (j.calls.length === 0) {
        expect(j.bucket).toBe("never_called");
      } else if (anyReached) {
        expect(["conversation", "answered_few_words"]).toContain(j.bucket);
        expect(j.firstReachAttempt).toBe(j.calls.find((c) => c.reached)!.attempt);
      } else {
        expect(["connected_no_conversation", "never_connected"]).toContain(j.bucket);
        expect(j.firstReachAttempt).toBeNull();
      }
    }
    expect(checkedMultiCall).toBeGreaterThan(10);
  });

  it("keeps the platform voicemail flag separate from the reach verdict", () => {
    // The flag is displayed but must not drive the verdict, so the fixture is
    // expected to contain disagreements in both directions.
    let flaggedButReached = 0;
    let unflaggedAndNotReached = 0;
    for (let i = 0; i < 120; i++) {
      const j = buildDemoJourney(`ACC-${5000 + i}`)!;
      for (const call of j.calls) {
        if (call.voicemailFlag && call.reached) flaggedButReached += 1;
        if (!call.voicemailFlag && !call.reached) unflaggedAndNotReached += 1;
      }
    }
    expect(flaggedButReached).toBeGreaterThan(0);
    expect(unflaggedAndNotReached).toBeGreaterThan(0);
  });

  it("renders tenant turns for a reached call", () => {
    const reachedAccount = Array.from({ length: 120 }, (_, i) => buildDemoJourney(`ACC-${5000 + i}`)!).find(
      (j) => j.bucket === "conversation",
    );
    expect(reachedAccount).toBeDefined();
    const call = reachedAccount!.calls.find((c) => c.reached)!;
    expect(call.transcriptAvailable).toBe(true);
    expect(call.turns.some((turn) => turn.role === "user")).toBe(true);
    expect(call.turns.some((turn) => turn.role === "assistant")).toBe(true);
  });

  it("attributes messaging steps by name and labels the match basis", () => {
    const journeys = Array.from({ length: 120 }, (_, i) => buildDemoJourney(`ACC-${5000 + i}`)!);
    const withMessaging = journeys.filter((j) => j.messaging.events.length > 0);
    expect(withMessaging.length).toBeGreaterThan(0);

    for (const j of withMessaging) {
      expect(["name", "ambiguous_name"]).toContain(j.messaging.basis);
      // The note must state the match is by name, never imply an account join.
      expect(j.messaging.note.toLowerCase()).toContain("name");
      for (const event of j.messaging.events) {
        expect(event.succeeded).toBe(!event.failed);
        expect(event.channelLabel.length).toBeGreaterThan(0);
      }
    }

    const withoutMessaging = journeys.filter((j) => j.messaging.events.length === 0);
    expect(withoutMessaging.every((j) => j.messaging.basis === "none")).toBe(true);
  });

  it("surfaces WhatsApp sends and failures distinctly", () => {
    const events = Array.from({ length: 120 }, (_, i) => buildDemoJourney(`ACC-${5000 + i}`)!).flatMap(
      (j) => j.messaging.events,
    );
    const whatsapp = events.filter((e) => e.channel === "whatsapp");
    expect(whatsapp.length).toBeGreaterThan(0);
    expect(whatsapp.some((e) => e.succeeded)).toBe(true);
    expect(whatsapp.some((e) => e.failed)).toBe(true);
  });
});
