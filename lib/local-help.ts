/**
 * "How do I…" questions about Datebook itself. These have one right answer —
 * where the control lives — so a model call only risks inventing a menu that
 * doesn't exist. Keep every path here in step with the real UI labels.
 */
import type { AssistantResponse } from "./ai-assistant";

type Help = { re: RegExp; text: string };

const HELP: Help[] = [
  {
    re: /\b(?:import|connect|sync|link|subscribe|add)\b.*\b(?:canvas|google calendar|outlook|ics|calendar (?:feed|link|url)|apple calendar|icloud)\b|\b(?:canvas|ics) (?:feed|link|import)\b/,
    text: "Go to **Settings → Import → Calendar link** and paste your calendar's .ics link (Canvas: Calendar → Calendar Feed; Google/Outlook: the secret iCal address). Datebook keeps it synced, and your own edits survive a refresh.",
  },
  {
    re: /\b(?:import|upload|add|attach|read|scan)\b.*\bsyllab(?:us|i)\b|\bsyllab(?:us|i)\b.*\b(?:import|upload)\b/,
    text: "Open **Settings → Classes**, then use the syllabus button on that class's row (or **Settings → Import → Syllabus PDF**). I'll pull out the due dates for you to review, plus the instructor, office hours, grading, and policies so you can ask me about them later.",
  },
  {
    re: /\b(?:class (?:times?|schedule|meetings?)|weekly meetings?|lecture times?|when my class(?:es)? meet)\b.*\b(?:add|set|change|edit|enter|put|update)\b|\b(?:add|set|change|edit|enter|update)\b.*\b(?:class (?:times?|schedule|meetings?)|weekly meetings?|lecture times?)\b/,
    text: "Open **Schedule** and tap **Class times**, pick the class, and add its days and times — changes save as you go. You can also just tell me, like “CS 101 meets MWF 10–10:50 in Hall B.”",
  },
  {
    re: /\b(?:notifications?|reminders?|alerts?|push)\b.*\b(?:turn on|enable|set up|get|change|default|stop|turn off|disable|work)\b|\b(?:turn on|enable|set up|get|change|default|stop|turn off|disable)\b.*\b(?:notifications?|reminders?|alerts?)\b/,
    text: "Reminder defaults live in **Settings → Reminders**: the presets new items get, and **Class heads-up** for how early you hear about class. To get notified when the app is closed, turn on reminders when Datebook asks (or from the setup card on Today) and allow notifications.",
  },
  {
    re: /\b(?:theme|dark mode|light mode|colou?rs?|appearance|look|accent|font)\b.*\b(?:change|switch|set|make|customi[sz]e|pick|turn on)\b|\b(?:change|switch|set|customi[sz]e|pick|turn on)\b.*\b(?:theme|dark mode|light mode|appearance|accent)\b/,
    text: "Head to **Settings → Look**. Pick a theme there, or choose **Custom** to set your own colors; the same card controls what shows on cards, like locations and class color dots.",
  },
  {
    re: /\b(?:sign in|log ?in|sign up|create an account|sync (?:across|between|to)|back ?up to the cloud|other devices?|my phone and (?:my )?(?:laptop|computer))\b/,
    text: "Open **Settings → Account & sync** and sign in with Google. Your calendar then backs up and stays in sync on every device you sign in on — and it keeps working offline in between.",
  },
  {
    re: /\b(?:export|download|back ?up|restore|save a copy)\b/,
    text: "**Settings → Backup & export** has it: **Download backup** saves a full copy you can restore later, and there's an .ics export for Google Calendar, Outlook, or Apple Calendar.",
  },
  {
    re: /\b(?:reset|wipe|erase|start over|delete (?:all|everything)|clear (?:all|everything|my (?:calendar|data)))\b/,
    text: "That's **Settings → Backup & export → Reset calendar data**. It can't be undone, so download a backup first if you might want anything back.",
  },
  {
    re: /\b(?:hide|show|see)\b.*\b(?:completed|done|finished|checked off)\b/,
    text: "Tap **Filter** and switch **Hide completed** on or off. It applies on every tab.",
  },
  {
    re: /\b(?:filter|views?|saved views?|only (?:see|show) (?:one|a|my) class)\b/,
    text: "Tap **Filter** to narrow things down by class, status, or type. Once it looks right, **Save this filter** turns it into a View you can switch back to anytime.",
  },
  {
    re: /\bfocus\b/,
    text: "Tap **Focus** at the top of **Today**. It starts a timed work session on whatever's most pressing, and it keeps running if you leave the page.",
  },
  {
    re: /\b(?:24[- ]hour|military time|12[- ]hour|clock format|week start|start (?:the|my) week|monday first|sunday first|open (?:to|on)|landing|default (?:tab|page|view)|density)\b/,
    text: "Those are in **Settings → Everyday preferences**: the 24-hour clock, which day the week starts on, which tab Datebook opens to, and calendar density.",
  },
  {
    re: /\b(?:add|create|new|rename|delete|remove|archive|recolou?r|colou?r)\b.*\b(?:class|classes|course|category|categories)\b/,
    text: "Classes are managed in **Settings → Classes** — add, rename, recolor, or archive them there. Each class row also has its syllabus and class times.",
  },
  {
    re: /\b(?:install|home ?screen|add to home|app icon|download the app)\b/,
    text: "In **Settings → Install app** you'll find the steps. On iPhone it's Share → **Add to Home Screen** in Safari; on desktop Chrome or Edge, use the install icon in the address bar.",
  },
  {
    re: /\b(?:search|find an? (?:item|event|assignment))\b/,
    text: "Use the **Search** icon at the top to find anything by name. Or just ask me — “when is the essay due?” works too.",
  },
  {
    re: /\b(?:add|create|make|put)\b.*\b(?:event|assignment|task|item|to ?do|deadline)\b/,
    text: "Tap **Add** and type it the way you'd say it — “essay due Friday 5pm” or “gym tomorrow at 6”. Or tell me here and I'll set it up for you to confirm.",
  },
  {
    re: /\b(?:move|reschedule|drag|change the (?:date|time))\b/,
    text: "Drag it to a new day on the calendar, or open it and change the date. You can also just tell me, like “move the essay to Monday.”",
  },
];

/** "how do I…", "where can I…", "is there a way to…" about the app itself. */
const HOW_TO =
  /^(?:how (?:do|can|would|should|could) (?:i|you|we)|how to|where (?:do|can|would|is|are) (?:i|you|the)|is there (?:a way|an option|a setting)|can i|can you (?:help me )?|i want to|i(?:'d| would) like to|i can't find|where's the|what's the setting|what setting)\b/;

export function answerHelpQuestion(q: string): AssistantResponse | undefined {
  if (!HOW_TO.test(q) && !/\bsettings?\b|\bin the app\b|\bin datebook\b/.test(q)) return undefined;
  // "can I turn in late work" / "can I use AI" are course questions, not app questions.
  if (/\b(?:late|extension|ai|chat ?gpt|office hours|professor|exam|syllabus says|allowed)\b/.test(q) && !/\bsyllabus\b.*\b(?:import|upload)\b/.test(q)) return undefined;
  const hit = HELP.find((h) => h.re.test(q));
  return hit ? { text: hit.text } : undefined;
}
