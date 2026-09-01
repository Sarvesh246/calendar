export default function TermsPage() {
  return (
    <article className="mx-auto flex w-full max-w-[640px] flex-col gap-6 pb-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Terms of use</h1>
        <p className="mt-1 text-[13px] text-ink-soft">Last updated September 1, 2026</p>
      </header>

      <section className="flex flex-col gap-3 text-[14px] leading-relaxed text-ink-soft">
        <p>
          By using Datebook you agree to these terms. If you do not agree, do not use the application.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">The service</h2>
        <p>
          Datebook provides a calendar, assignment tracker, and related tools for personal organization.
          Features may change as the product is updated. Cloud sync and the assistant require network access and optional sign-in.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Your content</h2>
        <p>
          You keep ownership of the calendar data you enter or import. You are responsible for the accuracy of that data and for keeping backup copies if you need them.
          Do not use Datebook to store unlawful content or credentials that should not be kept in a calendar app.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Acceptable use</h2>
        <p>
          Do not attempt to disrupt the service, access other users&apos; data, or abuse automated endpoints such as import, sync, or push dispatch.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Disclaimer</h2>
        <p>
          Datebook is provided as-is without warranties. We are not liable for missed deadlines, lost data, sync delays, or incorrect assistant responses.
          Use reminders and backups as a supplement to your own planning, not as a sole source of truth for critical obligations.
        </p>
        <h2 className="text-[15px] font-semibold text-ink">Changes</h2>
        <p>
          These terms may be updated from time to time. Continued use after an update means you accept the revised terms.
        </p>
      </section>
    </article>
  );
}
