# Datebook for Forerunner 165 Music

A Connect IQ **widget with a glance**, for the 390×390 AMOLED Forerunner 165 Music (`fr165m`). It does not record activities and requests only Communications and Background permissions.

## On your wrist

Add **Datebook** from the watch's **Glances → Add** list if it is not already visible. Open its glance with START. START or a tap on the dashboard opens the main menu. UP/DOWN moves through menus; START selects; BACK returns one level. Touch scrolling and selection use Garmin's native menus.

- Today, Open work, Overdue, In progress, Completed and Agenda.
- A complete month grid: UP/DOWN changes the selected day, START opens that day's list, hold UP opens previous/next month. Tap a date to select it.
- Classes and text search over downloaded items.
- Full titles, dates, class, location and up to 600 characters of notes, paginated with UP/DOWN. START opens actions.
- To do/incomplete, In progress and Done; priority; up to eight checklist steps; title and class edits.
- Move deadlines by choosing a date, tomorrow or one week. Plan work separately creates a 25/50 minute event now and preserves the deadline.
- Add a task with Garmin's keyboard (due today), set a 10/30/60 minute or one-day reminder, and a foreground 25-minute focus countdown. Reminder changes replace the item's existing time reminder list; phone/native reminder delivery remains owned by Datebook.

The focus countdown updates while its screen is open; it is not a closed-widget alarm. BACK leaves the timer screen. Imports, account management, attachments, the assistant, theme editing, deleting items, recurring-series editing and saved-view editing remain in the web app. This is the daily wrist workflow, not 90% parity with every web feature.

## Offline and sync

The last successful download remains on the watch. Changes are saved to an outbox before the screen changes. Open Datebook or choose **Sync now** to sync through **Garmin Connect Mobile + Bluetooth + phone internet**. The Datebook webpage does not need to stay open. A USB-connected watch generally cannot also communicate with Garmin Connect; unplug to test the real Bluetooth relay.

Background sync is requested every 15 minutes; Garmin controls actual scheduling and can delay it. It uploads changes and downloads five items at a time into an inactive cache, committing the replacement only when the download finishes. Foreground sync retries with backoff. A failed connection keeps cached data and queued changes. Server receipts make retries idempotent. Status changes have their own timestamp; stale conflicting edits are rejected, and Sync details shows a review notice. New local edits made during a sync remain queued for the next pass.

The offline cache holds **100 items**, prioritizing open assignments/tasks, then nearby events and recent completed work. Sync details reports when the cache is limited. Class names are included. Notes are limited to 600 characters, titles to 240, and checklists to eight steps; details indicate when more notes are available in Datebook. No old cached item is deleted from your account. The outbox holds 30 operations; sync before making more edits when full. All-day dates use the watch's local date. Ordinary shifts preserve the time shown on the watch; check times after crossing a daylight-saving boundary.

## Build

Install Garmin's official Connect IQ SDK Manager, SDK, `fr165m` device package, and Java. Run from this repository:

```powershell
# Create a key in Datebook → Settings → Account & sync → Garmin watch.
# Save {"token":"dbw_..."} in watch/secrets.local.json. Never commit it.
./watch/tools/build.ps1
```

The build creates a private signing key once and local `source/Secrets.mc` and `source/Seed.mc` files. Keep the signing key for updates. A normal fresh build starts with an empty cache; a personally provisioned USB build can include an ignored `Seed.mc` with a snapshot so the first offline launch already has data. Keys, snapshots and binaries are Git-ignored. Only the SHA-256 token digest is stored in Supabase; Settings can revoke all watch keys immediately. Revocation stops cloud access but does not erase the watch's offline cache. Remove the app from the watch to erase that local copy.

```powershell
./watch/tools/build.ps1 -TestBuild
$sdk = (Get-Content "$env:APPDATA/Garmin/ConnectIQ/current-sdk.cfg").Trim()
# Launch the simulator first. For full UI checks choose Settings → Glance Launch Mode → Launch in Normal Mode.
& "$sdk/bin/monkeydo.bat" watch/bin/datebook-test.prg fr165m /t
& "$sdk/bin/monkeydo.bat" watch/bin/datebook.prg fr165m
./watch/tools/sideload.ps1
```

The sideload script copies only `datebook.prg` to the connected watch's `Internal Storage/GARMIN/APPS`, copies it back, and verifies SHA-256. Unplug afterward and add Datebook to Glances. An identical USB readback verifies installation bytes; on-watch launch and Bluetooth behavior must also be checked on the physical device.

## Server

`GET /api/watch/sync` requires a watch bearer key and returns the first page, fixed item IDs, class names and summary. Later pages pass up to five IDs; every lookup is scoped to the key's owner. `POST` accepts at most 30 validated operations. Errors return private, non-cacheable responses; missing/revoked keys return 401. The browser never gets a service-role key, and the watch receives only its scoped token. The server uses `SUPABASE_SERVICE_ROLE_KEY`; apply the two watch migrations before deploying.

Watch keys live in `watch_devices` with owner-only RLS. `watch_receipts` has no public policies. The atomic operation RPC is executable only by `service_role`, validates the device owner/revocation again, locks edits and records receipts in the same transaction. Existing Datebook realtime sync picks up accepted changes.
