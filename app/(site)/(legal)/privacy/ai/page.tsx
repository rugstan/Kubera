import Link from "next/link";
import { LegalPage, TableScroll } from "@/components/legal/LegalPage";
import { legalMetadata } from "@/components/legal/metadata";
import { PrivacyRequestForm } from "@/components/privacy/PrivacyRequestForm";
import { site } from "@/lib/site";

export const metadata = legalMetadata(
  "/privacy/ai",
  "AI use and your choices",
  "Where Kubera Commercial uses AI, what it never sends to AI tools, how advisors review AI output, and how to ask for advisor-only handling.",
);

// Where AI is used. Kept in step with the model routing guard (lib/ai/routing.ts):
// restricted data only to Claude for document reading; market research models
// never receive information about you.
const USES = [
  {
    where: "Kubera AI (the Ask box)",
    what: "Answers general questions about loan programs and explains our sizing.",
    data: "What you type, and the deal details you choose to share with it.",
    review: "Answers are general information. An advisor reviews every engagement before anything goes to a lender.",
  },
  {
    where: "Deal qualifier and loan sizer",
    what: "Estimates which programs may fit and how quickly an advisor should follow up.",
    data: "The property, loan, and contact details you enter.",
    review: "An advisor reviews every request. No automated tool makes a credit decision; lenders make all credit decisions.",
  },
  {
    where: "Document reading",
    what: "Reads figures from operating statements, rent rolls, and similar files so an advisor can check them faster.",
    data: "The files you upload. These are the only place sensitive numbers can reach an AI tool, and only to read the document.",
    review: "An advisor checks extracted figures before they are used.",
  },
  {
    where: "Email sorting and drafting for advisors",
    what: "Sorts incoming email to the right deal and drafts notes and replies for an advisor.",
    data: "Messages you send us and the related loan file.",
    review: "Nothing is sent to you, a lender, or anyone else without an advisor's approval.",
  },
  {
    where: "Market research",
    what: "Summarizes public market news and rates for our team.",
    data: "Public information only. These tools never receive information about you or your loan.",
    review: "Reviewed by our team before use.",
  },
] as const;

export default function PrivacyAiPage() {
  return (
    <LegalPage
      title="AI use and your choices"
      intro={
        <p>
          Kubera is advisor-led and AI-assisted. We use AI tools to help licensed advisors work faster and more carefully. They do not replace the advisor, and they never make a
          credit decision. This page explains where we use AI, what we will not send to it, and how to ask us not to use it with your information. It supplements our{" "}
          <Link href="/privacy">privacy policy</Link>. Some of the uses below are being introduced over time; we list them here before they start.
        </p>
      }
    >
      <h2 id="where">Where we use AI</h2>
      <TableScroll label="Where we use AI">
        <table>
          <thead>
            <tr>
              <th scope="col">Where</th>
              <th scope="col">What it does</th>
              <th scope="col">Information it sees</th>
              <th scope="col">Human review</th>
            </tr>
          </thead>
          <tbody>
            {USES.map((u) => (
              <tr key={u.where}>
                <th scope="row">{u.where}</th>
                <td>{u.what}</td>
                <td>{u.data}</td>
                <td>{u.review}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <h2 id="safeguards">How we protect your information</h2>
      <ul>
        <li>
          <strong>Kubera AI is an AI assistant, not a person.</strong> It says so when you open it.
        </li>
        <li>
          <strong>Sensitive numbers stay out of AI tools.</strong> We screen what we send to AI models. Social Security numbers, dates of birth, and bank, card, and account
          numbers are removed or the request is blocked, except when an AI tool reads a document you uploaded.
        </li>
        <li>
          <strong>Market research tools never see information about you.</strong> The check blocks any personal or loan information from reaching them.
        </li>
        <li>
          <strong>No training on your information.</strong> We use AI providers under business terms that do not allow them to train their models on what we send. Our current AI
          provider is Anthropic.
        </li>
        <li>
          <strong>Sensitive information is encrypted.</strong> When we store fields such as Social Security numbers or account numbers, we encrypt each one separately, in
          addition to encrypting the database at rest.
        </li>
        <li>
          <strong>An advisor approves what goes out.</strong> No AI tool sends email, texts, or loan packages on its own.
        </li>
      </ul>

      <h2 id="retention">How long we keep AI conversations</h2>
      <p>
        Kubera AI conversations are kept for up to one year, unless they become part of a loan file, in which case they are kept with that file. See the{" "}
        <Link href="/privacy#retention">retention schedule</Link>. Records under a legal hold are kept until the hold ends.
      </p>

      <h2 id="choices">Your choices</h2>
      <p>
        <strong>Advisor-only handling.</strong> You can ask us not to use AI tools with your personal information and not to use automated scoring on your requests. An advisor
        will handle your requests personally. This takes effect as soon as we receive it, and it does not affect how we treat you or your request.
      </p>
      <p>
        You can also ask for a copy of your information, ask us to correct or delete it, or tell us not to sell or share it. We confirm receipt within 10 business days and respond
        within 45 days. Before we send or delete anything, we verify your identity by matching what you give us with what we already have.
      </p>

      <h3 id="request">Make a request</h3>
      <PrivacyRequestForm privacyEmail={site.privacyEmail} />
      <p>
        You can also email <a href={`mailto:${site.privacyEmail}`}>{site.privacyEmail}</a>.
      </p>
    </LegalPage>
  );
}
