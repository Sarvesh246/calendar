export default function PrivacyPage() {
  return (
    <article className="mx-auto flex w-full max-w-[640px] flex-col gap-6 pb-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Privacy policy</h1>
        <p className="mt-1 text-[13px] text-ink-soft">Last updated September 1, 2026</p>
      </header>

      <section className="flex flex-col gap-3 text-[14px] leading-relaxed text-ink-soft">
        <p>
          Datebook is a personal calendar and assignment tracker. Your schedule data is stored on your device by default.
          If you sign in with Google, your data is also stored in your Datebook cloud account and synced across devices you use with the same account.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Calendar items, categories, reminders, and settings you create in the app.</li>
          <li>Imported calendar feed URLs you choose to add (stored locally and in your cloud account if signed in).</li>
          <li>Your Google account identifier and email when you sign in for sync.</li>
          <li>Push notification subscription data if you enable reminders and sign in.</li>
        </ul>
        <h2 className="text-[15px] font-semibold text-ink">How we use it</h2>
        <p>
          Data is used only to operate Datebook: display your calendar, sync across your devices, send reminders you request, and run the optional assistant when you ask a question.
          We do not sell your data or use it for advertising.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Third parties</h2>
        <p>
          Sign-in uses Google OAuth through Supabase. The assistant sends your question and relevant calendar context to Google Gemini when you use that feature.
          Hosting is provided by Vercel. Each provider processes data according to its own policies.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Your choices</h2>
        <p>
          You can use Datebook offline without signing in. You can export a JSON backup or .ics file from Settings at any time.
          Signing out stops cloud sync on that device. Resetting calendar data removes items and feeds from the device.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Contact</h2>
        <p>
          Questions about this policy can be sent to the project maintainer through the repository listed for this application.
        </p>
      </section>
    </article>
  );
}
