// Ready-made question sets. The wording is the point: each one bakes in the
// conventions that keep a poll defensible, and carries the reasons so whoever
// edits it knows which words are load-bearing.
//
// Demographic options match the weighting presets in census.ts, so raking works
// without configuration. Every attitude question offers an explicit way out —
// "Don't know", "Haven't heard enough to say", "Prefer not to say" — because a
// respondent with no view who is given no way to say so will invent one, and
// that invented answer is indistinguishable from a real one in the results.

export interface PollTemplate {
  key: string;
  name: string;
  description: string;
  estimatedMinutes: string;
  topic: string;
  screening: string;
  survey: string;
  demographics: string;
  /** Why the wording is as it is. Shown beside the template. */
  notes: string[];
}

const AGE_AND_AREA = [
  "D1. Which district do you live in? (George Town / West Bay / Bodden Town / North Side / East End / Sister Islands / Prefer not to say)",
  "D2. And which age group do you fall into? (18 to 24 / 25 to 34 / 35 to 44 / 45 to 54 / 55 to 64 / 65 or older / Prefer not to say)",
  "D3. Do you describe yourself as male or female? (Male / Female / Another way / Prefer not to say)",
  "D4. And which of these best describes your status in Cayman? (Caymanian / Permanent resident / Work permit holder / Other / Prefer not to say)",
].join("\n");

const ADULT_RESIDENT =
  "S1. Are you 18 or older and currently living in the Cayman Islands? (Yes / No)";

export const POLL_TEMPLATES: PollTemplate[] = [
  {
    key: "tracker",
    name: "Direction and satisfaction tracker",
    description:
      "The repeatable core. Run it unchanged every wave so the numbers can be compared over time.",
    estimatedMinutes: "4",
    topic: "how things are going in Cayman",
    screening: ADULT_RESIDENT,
    survey: [
      "Q1. Generally speaking, do you think things in the Cayman Islands are heading in the right direction, or the wrong direction? (Right direction / Wrong direction / Don't know)",
      "Q2. Overall, how satisfied are you with the way things are going in the Cayman Islands today? (Very satisfied / Satisfied / Dissatisfied / Very dissatisfied / Don't know)",
      "Q3. What do you think is the single most important issue facing the Cayman Islands today? (Cost of living / Housing / Crime / Immigration and work permits / Health care / Education / Traffic and roads / The environment / Something else / Don't know)",
      "Q4. And thinking about your own household, compared with a year ago, is your financial situation better, about the same, or worse? (Better / About the same / Worse / Don't know)",
    ].join("\n"),
    demographics: AGE_AND_AREA,
    notes: [
      "Do not reword Q1 or Q2 between waves. A tracker is only worth running if the question is identical every time; changing a single word makes the trend meaningless and you cannot tell afterwards whether the country moved or the question did.",
      "Q3 comes before any question about a specific issue. Ask about housing first and housing becomes the most important issue — asking what matters before you suggest what might is the whole point of a salience question.",
      "The 4-point satisfaction scale has no midpoint on purpose. A middle option collects both genuine ambivalence and people who want the call to end, and the two are indistinguishable afterwards.",
    ],
  },
  {
    key: "favourability",
    name: "Leader and party favourability",
    description:
      "Opinion of named people or parties. Replace the bracketed names before running it.",
    estimatedMinutes: "5",
    topic: "public figures in Cayman",
    screening: ADULT_RESIDENT,
    survey: [
      "Q1. I'm going to read out some names. For each one, please tell me whether your opinion of them is favourable or unfavourable. If you haven't heard enough about them to say, just tell me that. First, [NAME 1]. (Very favourable / Somewhat favourable / Somewhat unfavourable / Very unfavourable / Haven't heard enough to say / Don't know)",
      "Q2. And [NAME 2]? (Very favourable / Somewhat favourable / Somewhat unfavourable / Very unfavourable / Haven't heard enough to say / Don't know)",
      "Q3. And [NAME 3]? (Very favourable / Somewhat favourable / Somewhat unfavourable / Very unfavourable / Haven't heard enough to say / Don't know)",
      "Q4. And [PARTY OR GROUP]? (Very favourable / Somewhat favourable / Somewhat unfavourable / Very unfavourable / Haven't heard enough to say / Don't know)",
    ].join("\n"),
    demographics: AGE_AND_AREA,
    notes: [
      "\"Haven't heard enough to say\" is not optional. Without it, name recognition is silently converted into opinion, and an unknown candidate comes back looking merely unpopular.",
      "Report the share who haven't heard of each name alongside the favourable and unfavourable figures. It is often the most useful number in the poll, and it is the one that moves first.",
      "The scale is balanced: two favourable options against two unfavourable. An unbalanced scale shifts the result on its own, regardless of opinion.",
      "Read the names in a different order for different respondents once option rotation is available — whoever is read first gains a few points simply for being first.",
    ],
  },
  {
    key: "issue-policy",
    name: "Issue salience and a policy choice",
    description:
      "What people care about, then a balanced two-sided policy question. Replace the bracketed arguments.",
    estimatedMinutes: "5",
    topic: "issues facing Cayman",
    screening: ADULT_RESIDENT,
    survey: [
      "Q1. What do you think is the single most important issue facing the Cayman Islands today? (Cost of living / Housing / Crime / Immigration and work permits / Health care / Education / Traffic and roads / The environment / Something else / Don't know)",
      "Q2. And how serious a problem is [ISSUE] in Cayman today? (A very serious problem / A somewhat serious problem / Not a very serious problem / Not a problem at all / Don't know)",
      "Q3. Some people say [ARGUMENT FOR, stated in one sentence]. Others say [ARGUMENT AGAINST, stated in one sentence of similar length]. Which comes closer to your own view? (Closer to the first / Closer to the second / Neither / Don't know)",
      "Q4. And how much would [POLICY] affect you or your household personally? (A great deal / A fair amount / Not very much / Not at all / Don't know)",
    ].join("\n"),
    demographics: AGE_AND_AREA,
    notes: [
      "In Q3 both arguments must be stated, and stated at roughly the same length and strength. A one-sided question measures your framing, not public opinion, and it is the single easiest way to produce a number nobody should trust.",
      "Q1 runs before Q2 and Q3 so the issue you are about to ask about does not inflate its own salience.",
      "Do not use the word \"ban\", \"force\" or \"allow\" in Q3 unless the policy genuinely says so. Loaded verbs move results by more than most real-world opinion shifts.",
      "If you quote Q3, publish its full wording. A two-sided question is only defensible if people can read both sides.",
    ],
  },
  {
    key: "referendum",
    name: "Referendum or ballot question",
    description:
      "Voting intention on a specific ballot question. Paste the exact ballot wording — do not paraphrase it.",
    estimatedMinutes: "4",
    topic: "the referendum",
    screening: [
      ADULT_RESIDENT,
      "S2. Are you registered to vote in the Cayman Islands? (Yes / No / Not sure)",
    ].join("\n"),
    survey: [
      "Q1. If a referendum were held tomorrow, how likely would you be to vote? (Certain to vote / Very likely / Fairly likely / Not very likely / Certain not to vote / Don't know)",
      "Q2. The question on the ballot would be: \"[EXACT BALLOT WORDING]\". If that referendum were held tomorrow, would you vote yes, or would you vote no? (Yes / No / Would not vote / Undecided)",
      "Q3. And how firmly do you hold that view? (Very firmly / Fairly firmly / I could still change my mind / Don't know)",
      "Q4. Which of these comes closest to the main reason for your answer? (It affects me or my family directly / I disagree with how it was decided / I trust the people proposing it / I do not trust the people proposing it / Something else / Don't know)",
    ].join("\n"),
    demographics: AGE_AND_AREA,
    notes: [
      "Likelihood to vote is asked before voting intention, never after. Asking someone how they would vote and then whether they would vote invites them to justify the answer they just gave.",
      "Use the ballot wording verbatim in Q2, however awkward it reads. Polling a tidied-up version measures a question nobody will be asked.",
      "Report \"Undecided\" as its own figure. Redistributing undecideds in proportion to decided voters is a modelling choice, not a result; if you do it, publish both numbers and say which is which.",
      "Q3 is what tells you whether a lead is soft. A 20-point lead where half say they could still change their mind is a different story from one where they could not.",
      "Only report among likely voters if you say so explicitly, and publish the unfiltered figure alongside it.",
    ],
  },
];

export function findTemplate(key: string): PollTemplate | undefined {
  return POLL_TEMPLATES.find((t) => t.key === key);
}
