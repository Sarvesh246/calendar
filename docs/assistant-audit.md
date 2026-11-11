# Assistant audit — 10 Nov 2026

Audit only. Nothing in the app was changed.

## How this was tested, and what was not

| Area                                        | How                                                                                                                                                        | Confidence                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Phone chat UI                               | `main` on localhost at 375×812, driven through the real sheet                                                                                              | Observed                       |
| Keyboard                                    | Faked `visualViewport` height/offset on that page and measured where the composer landed                                                                   | Simulated, not a real keyboard |
| On-device engine (`lib/local-assistant.ts`) | 30 messages typed into the chat against a copy of your data plus temporary `ZZTEST` items                                                                  | Observed                       |
| Model path                                  | A scratch script replaying the exact server prompt, tool schema, temperature and loop against `gemini-3.5-flash-lite`, with a synthetic calendar, 25 calls | Observed for Gemini only       |
| Server confirm / history / sync             | Code reading                                                                                                                                               | Not executed                   |

Three limits you should know about:

- **The live site could not be reached from this network.** Cisco Umbrella intercepts `datebookcalendar.vercel.app` (it serves its own certificate), so I did not test through your signed-in production account. Localhost had a guest copy of your data (59 items, 9 classes) and no sign-in.
- **Production's first-choice model is Groq GPT-OSS 120B.** Only a Gemini key exists locally, so model findings are for the Gemini fallback. The prompt and tool problems apply to every provider; the exact error rate may differ.
- **No real phone keyboard was involved.** The keyboard section says which parts are measured and which are inference.

Cleanup: the local store was restored from a snapshot and its SHA-256 matches the pre-test value (`41bade38…43c1`, 59 items, 0 `ZZTEST`). Session keys and the backup key were removed, the dev server is stopped, and the git tree is unchanged apart from this file. Nothing was written to your cloud account. Five items named `Repro 0`–`Repro 4` (POLS 207, 15 Oct) were already in the local copy before I started; I left them.

---

## 1. Keyboard covers the composer (phone)

### What was measured

The sheet is `position: absolute` inside a `fixed inset-0` overlay, and its `bottom` and `max-height` are driven by one JS-published variable, `--keyboard-inset` (`components/ai-drawer.tsx:123`, `lib/use-keyboard-inset.ts`, `lib/viewport-offsets.ts:248`).

| Simulated keyboard state                          | `--keyboard-inset` | Composer (y) | Visible band | Result                                             |
| ------------------------------------------------- | ------------------ | ------------ | ------------ | -------------------------------------------------- |
| Field focused, browser reports no viewport change | 0                  | 730–787      | 0–476        | **Composer fully under the keyboard**              |
| `vv.height` 476, no pan                           | 336                | 398–455      | 0–476        | Visible                                            |
| `vv.height` 476, panned 300                       | 36                 | 698–755      | 300–776      | Composer visible, **header and Close off the top** |
| `vv.height` 476, panned 120                       | 216                | 518–575      | 120–596      | Composer visible, **header off the top**           |
| `vv.height` 420 (keyboard + suggestion bar)       | 392                | 342–399      | 0–420        | Visible, thread squeezed to 261px                  |

So the layout is correct only when the browser reports the keyboard through `visualViewport`, and it has no fallback when it does not.

### Why it fails on a real phone

1. **`interactiveWidget: "overlays-content"` (`app/layout.tsx:34`) tells Chromium not to resize either viewport for the keyboard.** In that mode the only way to learn the keyboard's size is the VirtualKeyboard API (`navigator.virtualKeyboard`, `env(keyboard-inset-height)`). The codebase never uses it (no match for `virtualKeyboard` or `keyboard-inset-height`). On Android Chrome and the installed Android PWA this is the first row of the table every time. This one is certain from the code.
2. **On iOS the report arrives late.** `visualViewport` `resize` fires after the keyboard animation ends, so for roughly half a second the composer sits under the keys. The sheet then moves with a 280ms `bottom` transition, and `useKeepFieldVisible` measures 120ms into that transition (`lib/use-keep-field-visible.ts:106`), while the sheet is still mid-flight. Inference from code; needs a device to confirm how visible it is.
3. **When iOS pans the page to reveal the field, the sheet is taller than the visible band,** so the title and Close button go off the top (rows 3–4). `max-height` subtracts the inset but not the pan.
4. **`useKeepFieldVisible` has nothing to scroll.** The composer has no scrolling ancestor inside `composerRef`, so it falls through to `window.scrollBy` on a document that is `overflow: hidden` and exactly one viewport tall. It is a no-op here.
5. **Inside the IPA** the WebView is created with `contentInsetAdjustmentBehavior="never"` and `automaticallyAdjustContentInsets={false}` (`Calendar-ios/App.tsx:590`). I could not verify how WKWebView reports the keyboard under those settings. If it does not shrink `visualViewport`, the IPA is permanently in row 1.

I cannot tell you from here which of 2–5 you are hitting on your phone. Step 1 of the fix settles it in two minutes.

### Fix plan

**Step 1 — measure on the device (15 min, throwaway).** Add a `?kbdebug=1` overlay that prints `visualViewport.height/offsetTop`, `innerHeight`, `documentElement.clientHeight`, `--keyboard-inset` and whether `navigator.virtualKeyboard` exists. Open the assistant in the IPA, Safari and the installed PWA, focus the field, screenshot each. This decides whether step 3b is needed.

**Step 2 — make the phone assistant a full-height room instead of a floating card.** This is the significant UI change, and it removes most of the geometry problem:

- `components/ai-drawer.tsx`: on `max-md`, replace the `bottom-[…] h-[70dvh] max-h-[min(560px,…)]` card with a sheet pinned to the visible viewport: `top: var(--viewport-pan)`, `height: var(--visible-height)` (both already published by `useKeyboardInset`), full width, top corners rounded only. Remove the `transition-[bottom]`.
- The conversation is already a flex column (header / thread `flex-1 min-h-0` / composer `shrink-0`). With the container equal to the visible band, the composer is its last flex child and cannot be covered, and the header cannot leave the top, whatever the pan is.
- Add `padding-bottom: env(safe-area-inset-bottom)` to the composer wrapper when the keyboard is closed.
- Move the sheet onto `useSheetPhysics` like every other sheet, with detents `full` only, so drag-to-dismiss keeps the finger's velocity. Today it is the one sheet on framer `drag`.
- Drop `useKeepFieldVisible` from `assistant-conversation.tsx`; it has no job in this layout.

**Step 3a — give Chromium a real keyboard signal.** In `lib/use-keyboard-inset.ts`, when `navigator.virtualKeyboard` exists: set `overlaysContent = true`, listen to `geometrychange`, and feed `boundingRect.height` into `keyboardInset` (take the max of that and the `visualViewport` value). Add a `keyboardRect` field to `ViewportMetrics` and a case in `lib/viewport-offsets.test.ts`. Keep `overlays-content`; the rest of the app's chrome depends on it.

**Step 3b — only if step 1 shows the IPA reports nothing.** In `Calendar-ios/App.tsx`, subscribe to `Keyboard` `keyboardWillChangeFrame` and push `{height, duration}` over the existing bridge (`pushBridge`); in `lib/native-bridge.ts` write it to `--keyboard-inset`. Needs a new IPA.

**Step 4 — react before the keyboard finishes.** On `focusin` of the composer, pre-apply the last known keyboard height (persist it in `sessionStorage`) so the sheet moves with the keyboard instead of after it; correct when the real value arrives.

**Verify:** the table above re-run must show composer and header visible in all five rows; then the three device screenshots from step 1 repeated.

---

## 2. The assistant gets things wrong

### 2.1 High — one "Add" tap created 156 items

Typed: `add ZZTEST study group thursday 7pm and ZZTEST lab report due sunday`

Reply: _"I'll add ZZTEST study group and ZZTEST lab report, every Sunday and Thursday at 19:00 starting today."_ One card, one **Add** button, item count went 61 → 217. Two separate things were merged into one recurring series with no end date, and the card never said how many items it would write.

- Cause: `addIntent` (`lib/local-assistant.ts:1899`) hands the whole sentence to `parseQuickAdd`, which reads two weekday names as a weekly repeat. `titleIsFaithful` passes because every word survived into the title.
- Fix:
  1. In `addIntent`, return `null` (defer to the model) when the sentence contains `and` / `,` / `;` joining two date or time expressions, or two weekday names without `every|each|weekly`.
  2. Require an explicit recurrence word before accepting `parsed.repeat`.
  3. In the confirm card, show the count for a series ("Adds 156 events, weekly until …") and require an `until`; with none, ask "until when?" instead of staging.
  4. Tests in `lib/local-assistant.test.ts` for both sentences.

### 2.2 High — model-path cards do not say what will change

`lib/llm/tools.ts:356-361` builds summaries as `Add event “dentist”`, `Update “Chem lab report 6”`, `Delete “…”`. `actionFacts` in the UI adds only location and reminder labels. A reschedule from the model therefore shows **Update "Chem lab report 6" → Reschedule**, with no old or new date. The on-device engine does this properly ("Move "Gym" to tomorrow at 19:00").

- Fix: build the card from the normalised action on the client, not from the server string. Add `describeAction(action, items, clock24h)` in `lib/assistant-actions.ts` returning `{title, when, changes: [{field, from, to}]}`, and render it in a new `AssistantActionCard` component (see 3.2). Use it for both engines so the two paths look identical.

### 2.3 High — "am I free?" is wrong on both engines

- On-device: with an event at 19:00 Thursday, `when am I free on thursday?` answered _"Thursday is wide open — nothing timed on your calendar."_ The free-time window is working hours only, and the "nothing timed" sentence is used whenever nothing falls inside that window (`lib/local-assistant.ts:3378`).
- Model: `am I free thursday at 7pm?` answered _"Yes, you are free at 7:00 PM on Thursday, November 13"_. Thursday was the 12th and there was a 7 PM event in both the snapshot and the tool result.
- Fix (local): compute `timed` over the whole day; say "wide open" only if the whole day is empty, otherwise "free 9–5; **Study group** at 19:00".
- Fix (model): see 2.4 and 2.6.

### 2.4 High — the model keeps getting weekdays wrong

Three of sixteen model cases named the wrong weekday or date for an item that was in front of it ("Advisor meeting on Wednesday" for a Thursday, "POLS essay due Thursday" for a Friday, "Thursday, November 13"). The snapshot gives `2026-11-12 15:00` with no weekday, so the model does calendar arithmetic in its head.

- Fix in `app/api/assistant/route.ts` `systemPrompt`:
  1. Put the weekday in every snapshot line: `Thu 2026-11-12 15:00`. Change `localStamp` to emit it.
  2. Add a 14-day lookup line: `Dates: Tue Nov 10 (today), Wed Nov 11 (tomorrow), …`.
  3. Tell the model to copy weekday and date from those lines and never compute them.
- Add a server-side check: after the final text, scan for `Weekday, Month D` pairs and replace a mismatched weekday with the correct one (cheap, deterministic, catches the remainder).

### 2.5 High — the model cannot create a repeating item

`normalizeActions` understands `repeatFreq`, `repeatDays` and `until` (`lib/assistant-actions.ts:57-60`), but the tool schema in `lib/llm/tools.ts` has no repeat fields. Asked for "gym every monday and wednesday at 6am for the rest of the month", the model staged four separate events and missed two of the six dates (Nov 11 and Nov 30).

- Fix: add `repeat: {freq, byDay, until}` to `add_event` in both the zod schema and the JSON schema, pass it through `actionFor`, and expand it in `confirmPendingAction` with the same series code the store uses (extract that into a shared pure function so server and client cannot drift). Add a `replace_series` path later for changing saved class times.

### 2.6 Medium — tool results are trusted, never checked

- `list_events`/`list_tasks` are available, but for a conflict question the model answered against its own guess. Add a dedicated read tool `check_availability(start, end)` that returns `{free: boolean, conflicts: [...]}` computed in code, and instruct the model to use it for every "am I free / can I fit" question. A boolean from code is harder to misread than a list.
- Adding "Study group Thursday 7pm" when "Study group meeting" already sat at Thursday 7 PM staged a duplicate with no comment, both runs. In `executeDatebookTool`, before staging an add, look for an existing item with a similar title within ±2h and return `{possibleDuplicate: {...}}` in the tool output so the model can ask.

### 2.7 Medium — items land in the wrong class

`lib/llm/tools.ts:409-415`: when the model gives no `categoryId`, the server assigns `categories[0]`. In the multi-add test, run 1 put the study group in CHEM and run 2 left it blank, which in production becomes your first class (COMU-010 in your list). The project rule is that the chip must name the class an item will actually get.

- Fix: remove the silent default. Leave `categoryId` empty and let the client apply `fallbackCategoryId` with the same resolution as `lib/composer-fields.ts`, and show the resolved class on the card as an editable chip.

### 2.8 Medium — details dropped or invented

- "dentist next tuesday 3pm **at the clinic on main st**": location dropped in both runs. Title left lower-case.
- Multi-add run 2 invented a 20:30 end time nobody gave.
- On-device: `add ZZTEST calc homework due friday 11:59pm for math` produced the title **"ZZTEST calc homework due for math"**.
- Fix: after the model's tool call, run a deterministic completeness check on the server: every time, place phrase (`at|in the …`) and reminder phrase found in the user's message must appear in some staged action; on a miss, send one corrective tool message ("location 'the clinic on main st' was not included") using the retry slot that already exists for malformed arguments. Sentence-case titles in `actionFor`. For the local title, strip a trailing `due` and `for <class>` in `addIntent` after the class has been matched.

### 2.9 Medium — "this week / last week" answers use the wrong field

- On-device `what's due this week?` listed a 19:00 event as "due". `dueBetween` filters `isOpen` items without excluding events (`lib/local-assistant.ts:2367`).
- Model `what did I finish last week?` listed an item due _this_ week. The snapshot has no `completedAt`, so it cannot know when something was finished.
- Fix: filter `type !== "event"` in `dueBetween` (report events in a separate "and on your calendar" clause). Add `completedAt` to the snapshot line for done items and to `list_tasks` output.

### 2.10 Medium — a stale card reports success for a change that did not happen

Sequence: ask to rename Gym (card left open), ask to delete Gym, confirm the delete, then tap **Rename** on the older card. The card turned to **✓ Done**; the item no longer existed. `applyAction` (`lib/assistant-session.ts:253`) calls `updateItem` and marks the action applied without checking the target.

- Fix: in `applyAction`, look the item up first; if it is gone, resolve the card as `"stale"` with "This item no longer exists". When a new reply targets an item that has an open card, mark the older card superseded. Expire open cards after 30 minutes to match the server's `expires_at`.

### 2.11 Medium — the server confirm path bypasses the sync rules (code reading, not executed)

`confirmPendingAction` in `lib/llm/tools.ts`:

- **Deletes are hard deletes** (`.delete()`), with no tombstone. Your sync model is tombstones plus last-write-wins, so another device holding the item can upload it again.
- **The client replaces its copy with a lossy mapping.** `itemFromServer` (`lib/assistant-session.ts:50`) keeps 14 fields and drops `url`, `sourceId`, `sourceUid`, `repeat`, `repeatId`, `workFor`. After the assistant edits an imported Canvas item, the local copy loses its link and source ids, and import de-duplication can then re-add it.
- **`setState` is used instead of the store actions,** so reminder scheduling, the save pill, native widget refresh and undo do not run. Deleting through the on-device engine shows an Undo toast; deleting through the model does not.
- Fix: make the server confirmation a validation step only. `/api/assistant/confirm` returns the validated arguments, and the client applies them through `addItem`/`updateItem`/`deleteItem`, which already handle tombstones, sync, reminders and undo. Delete `itemFromServer`.

### 2.12 Low — smaller reliability problems

| Problem                                                                                                  | Evidence                                                                                                                | Fix                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Queue holds one message                                                                                  | Sent three quickly; "first queued" vanished, only "second queued" ran (`queued: string \| null`)                        | Make `queued` an array, show each as a pending bubble                                                           |
| No streaming                                                                                             | Model replies took 0.7–10.9s behind three dots                                                                          | Stream text with SSE from `/api/assistant`; cards arrive in a final event                                       |
| Rate limits are per-instance memory                                                                      | `rateLimit` and `cooldownUntil` (`lib/llm/router.ts:16`) reset on every cold start                                      | Move both to the durable limiter that already exists                                                            |
| Any server error returns 200 `assistant-unreachable`, then the client answers from the offline heuristic | `route.ts:377`, `ai-assistant.ts:473`                                                                                   | Return a typed error; show "couldn't reach the assistant" with Retry rather than a guess presented as an answer |
| Guest state mislabelled                                                                                  | Every model-bound message as a guest shows "Sign in with Google…" with **Offline answer · retry**; retry can never work | Dedicated signed-out card with a Sign in button that starts OAuth                                               |
| History trimmed to 700 chars per turn and 8 turns                                                        | `route.ts:39-40`                                                                                                        | Keep the last assistant turn whole, since pronouns resolve against it                                           |
| Typos fall through to the model                                                                          | `whats du tmrw` went to the network                                                                                     | Add a small normaliser (`du→due`, `tmrw→tomorrow`, `tmr`, `2morrow`, `hw`) before intent matching               |
| Simple date maths goes to the model                                                                      | `how many days until thanksgiving`                                                                                      | Add US holidays to `lib/local-math.ts`                                                                          |
| "undo that" not understood                                                                               | Went to the model                                                                                                       | Keep the last applied action in the session and offer real undo                                                 |

---

## 3. Output structure

### 3.1 The two engines do not sound or look alike

Same question, different shapes:

- On-device: `This week you have **A** (Thu, Nov 12 at 19:00) and **B** (Fri, Nov 13) due.`
- Model, run 1: `Based on your digest, here is what is due this week:` then `* ` bullets with `Wednesday, Nov 11`.
- Model, run 2: same opener, bullets with `Wednesday, November 11` and a class in brackets.

Observed across the model runs: "Based on your digest" / "Based on your data" (internal wording leaking), `*` bullets in one answer and `-` in the next, an italic bracketed note as a trailing paragraph, dates in three formats, years included sometimes, class names included sometimes. When the model only calls tools it writes no text at all and the server substitutes a generic line.

- Fix, in order of leverage:
  1. **Stop asking the model to format lists.** Add a read tool `show_items(ids, heading)` whose result the client renders as real item rows (title, class dot, formatted due time, status). The model's text becomes one sentence of framing. Dates are then formatted by `fmtTime`/`dayName`, the same code the on-device engine uses, so both paths match by construction.
  2. Tighten the prompt's style section with two worked examples and explicit bans: no "based on", no year, no italics, `-` bullets only, dates as `Thu, Nov 12`.
  3. Add a `polishReply()` pass on the server: strip "Based on your …,", normalise `*` bullets to `-`, drop a trailing italic note into a plain sentence.
  4. Lower temperature from 0.2 to 0 for tool-calling turns (`lib/llm/openai-compatible.ts:98`).

### 3.2 Messages are plain text; they should be typed parts

`AssistantMessage` is `{text, actions?, suggestions?}`. Lists of items are markdown bullets you cannot tap.

- Fix: change the message to `parts: Array<{type: "text"} | {type: "items", ids} | {type: "action", …} | {type: "choice", options} | {type: "notice", tone}>` and render each with its own component:
  - **Item rows** open the item sheet on tap and show status live.
  - **Action cards** show from → to (2.2), the class chip (2.7), and Confirm at 44px.
  - **"Which one?" questions** become tappable choices. Today the model asks "Advisor meeting or Study group meeting?" and you must type the answer.
  - **Batch cards**: several actions in one reply get "Confirm all (3)" and one summary.
- Keep `text` readable from `sessionStorage` so old sessions still load.

### 3.3 Markdown renderer gaps (`lib/markdown.tsx`)

No nested lists, no tables (the prompt forbids them, the model still can emit them), headings are stripped to plain lines. Fine once 3.1 lands; add a nested-list case and render a table as stacked rows so a stray one does not print as pipes.

---

## 4. Phone UI

Measured at 375×812.

| Finding                                         | Evidence                                                                                                                                           | Fix                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| No way to start a new conversation on a phone   | "New conversation" button is `hidden md:flex` (`assistant-conversation.tsx:179`); thread reached 51 messages                                       | Show it on phone; also offer it automatically after an hour idle                                      |
| Model picker is the loudest thing in the header | The select is styled at 11.5px, but the global anti-zoom rule (`globals.css:573`) forces 16px, so "Auto" renders larger than the "Assistant" title | Remove it from the header on phone. Put "Model" in a ⋯ menu or Settings; almost nobody should need it |
| Touch targets under 44px                        | Confirm/Cancel 56×26, "Offline answer · retry" 121×17, suggestion chips 30 high, Close 36×36                                                       | 44px minimum for all four; make Retry a real button                                                   |
| Enter does not send                             | `enterKeyHint="enter"`, send only on Ctrl/Cmd+Enter                                                                                                | `enterKeyHint="send"`, Enter sends, Shift+Enter for a newline on hardware keyboards                   |
| Thread is 13px in a 560px card                  | Assistant and user text both 13px; card uses 69% of the screen height                                                                              | 15px text in the full-height room from section 1                                                      |
| Only the last 24 messages survive a reload      | UI showed 51, `sessionStorage` held 24                                                                                                             | Keep 60, or page older ones                                                                           |
| Screen readers get nothing when a reply lands   | Thread has no `role` or `aria-live`                                                                                                                | `role="log" aria-live="polite"` on the thread, `aria-label="Assistant is replying"` on the dots       |
| Artificial delay on instant answers             | On-device replies took 1.3–2.6s end to end                                                                                                         | Cap `localReplyDelayMs` at 300ms; with streaming the model will no longer feel slower by comparison   |
| Suggestion chips only on the welcome message    | By design for local replies                                                                                                                        | After each answer offer 2 contextual follow-ups generated in code ("Show overdue", "Add a reminder")  |
| No context when opened from an item or a day    | Opening from Calendar on a selected day sends nothing about that day                                                                               | Pass `{selectedDay, openItemId, activeClass}` in the request; "move this to Friday" then works        |

**Proposed phone layout (the significant change):** full-height room with a Done header like Settings and Schedule (`MobileRoomHeader`), title "Assistant", trailing actions New chat and ⋯. Thread at 15px with typed parts. Composer pinned to the keyboard, with a row of two or three contextual chips above it that hides while typing. Desktop keeps the tall column.

---

## 5. Order of work

| #   | Change                                                                                                           | Why first                                         | Size |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---- |
| 1   | Keyboard: device measurement, full-height room, VirtualKeyboard signal (section 1)                               | The bug you reported                              | M    |
| 2   | Series guard and count on cards (2.1), stale-card check (2.10)                                                   | Stops silent bulk writes and false "Done"         | S    |
| 3   | Client-built action cards with from → to (2.2), class chip (2.7)                                                 | You currently confirm model changes blind         | M    |
| 4   | Weekdays in the snapshot, date table, weekday check (2.4); `check_availability` (2.6); local free-time fix (2.3) | Removes the wrong-answer class found in testing   | S    |
| 5   | Confirm path through store actions (2.11)                                                                        | Sync correctness; verify against production first | M    |
| 6   | Typed message parts and item rows (3.2), `show_items` (3.1)                                                      | Makes both engines look the same                  | L    |
| 7   | Repeat support in tools (2.5), completeness check (2.8), duplicate hint (2.6)                                    | Agentic depth                                     | M    |
| 8   | Streaming, queue array, typed errors, durable cooldowns (2.12)                                                   | Perceived speed and honesty about failures        | M    |
| 9   | Phone polish table (section 4)                                                                                   | Mostly small                                      | S    |

### A regression suite, so this does not drift again

Promote the scratch harness into `lib/assistant-eval.test.ts`, skipped unless `GEMINI_API_KEY`/`GROQ_API_KEY` is set: a fixed synthetic calendar, the 16 prompts used here, and assertions on staged tool calls (ids, dates, location present, no duplicate) plus a weekday check on the text. Run each prompt three times and fail on any disagreement in the staged actions. Run it against every provider in `LLM_PROVIDERS` before changing the prompt or the routing order.

### Still to check once the live site is reachable

- The server confirm path end to end on your account (2.11), including whether an assistant edit strips `url` from an imported item.
- Groq GPT-OSS 120B against the same 16 prompts.
- The three device screenshots from section 1, step 1.
