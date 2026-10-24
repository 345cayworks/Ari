// Single source of truth for what the Retell polling agent can call
// during a call (tools) and what Retell extracts after it (analysis).
// `npm run retell:sync` pushes both to the Retell agent.

export const MANAGED_TOOL_NAMES = [
  "record_answer",
  "add_to_do_not_call",
  "schedule_callback",
  "end_call",
  "transfer_call",
] as const;

export function buildGeneralTools(opts: {
  functionsUrl: string;
  transferNumber?: string;
}): Record<string, unknown>[] {
  const custom = (tool: Record<string, unknown>) => ({
    type: "custom",
    url: opts.functionsUrl,
    method: "POST",
    speak_during_execution: false,
    speak_after_execution: true,
    timeout_ms: 5000,
    ...tool,
  });

  const tools: Record<string, unknown>[] = [
    custom({
      name: "record_answer",
      description:
        "Save the respondent's answer to one survey question. Call this " +
        "immediately after every screening, survey and demographic answer, " +
        "before asking the next question. Do not say anything about saving.",
      // Safe to retry: answers upsert on (call, question_id).
      max_retry: 1,
      parameters: {
        type: "object",
        properties: {
          question_id: {
            type: "string",
            description:
              "The question's ID exactly as written in the question list, e.g. S1, Q3, D2.",
          },
          answer: {
            type: "string",
            description:
              "The chosen answer option, worded exactly as in the option list. " +
              "Use DON'T KNOW or REFUSED when applicable. For open-ended " +
              "questions, a faithful summary in the respondent's words.",
          },
          verbatim: {
            type: "string",
            description: "What the respondent actually said, if it differed from the option wording.",
          },
        },
        required: ["question_id", "answer"],
      },
    }),
    custom({
      name: "add_to_do_not_call",
      description:
        "Permanently remove this number from all future calls. Call this " +
        "whenever the respondent asks not to be called again, then confirm and end the call.",
      max_retry: 1,
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Short reason in the respondent's words, if given.",
          },
        },
      },
    }),
    custom({
      name: "schedule_callback",
      description:
        "Record that the respondent wants to be called back at a better time. " +
        "Ask when suits them first, then call this.",
      max_retry: 1,
      parameters: {
        type: "object",
        properties: {
          preferred_time: {
            type: "string",
            description:
              "When they asked to be called, as they said it, e.g. 'tomorrow after 6pm'.",
          },
        },
        required: ["preferred_time"],
      },
    }),
    {
      type: "end_call",
      name: "end_call",
      description:
        "Hang up. Use after the closing line, a refusal, a screen-out, a " +
        "do-not-call request, voicemail, or when the respondent is hostile or distressed.",
    },
  ];

  if (opts.transferNumber) {
    tools.push({
      type: "transfer_call",
      name: "transfer_call",
      description:
        "Transfer to a human at the office. Only use when the respondent asks " +
        "to speak to a person or wants to make a complaint.",
      transfer_destination: { type: "predefined", number: opts.transferNumber },
      transfer_option: { type: "cold_transfer" },
      speak_during_execution: true,
      execution_message_description: "Tell them you're connecting them to a member of the team now.",
    });
  }

  return tools;
}

export const CALL_OUTCOMES = [
  "completed",
  "partial",
  "refused",
  "screened_out",
  "callback_requested",
  "do_not_call",
  "voicemail",
  "wrong_number_or_language",
  "hostile",
  "distressed",
  "no_conversation",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

// Post-call analysis is configured once per agent, but questions change per
// poll, so answers come live from record_answer. These fields capture the
// call's disposition and quality, plus answers_json as a fallback.
export const POST_CALL_ANALYSIS_DATA: Record<string, unknown>[] = [
  {
    type: "system-presets",
    name: "call_summary",
    description:
      "Two sentences on how the call went (consent, how far they got, any issues). " +
      "Do not include the respondent's opinions or any identifying details.",
  },
  {
    type: "system-presets",
    name: "call_successful",
    description: "True only if the respondent consented and answered through to the closing line.",
  },
  {
    type: "system-presets",
    name: "user_sentiment",
    description: "The respondent's attitude towards being surveyed, not towards the survey topics.",
  },
  {
    type: "enum",
    name: "call_outcome",
    description: "The single best description of how the call ended.",
    choices: [...CALL_OUTCOMES],
  },
  {
    type: "boolean",
    name: "consent_given",
    description: "Did the respondent clearly agree to take part after hearing the introduction?",
  },
  {
    type: "boolean",
    name: "do_not_call_requested",
    description: "Did the respondent ask not to be called again, in any words?",
  },
  {
    type: "string",
    name: "callback_requested_time",
    description: "When the respondent asked to be called back, as they said it.",
    conditional_prompt: "Only fill this if the respondent asked to be called back later.",
    examples: ["tomorrow after 6pm", "Saturday morning"],
  },
  {
    type: "string",
    name: "last_question_reached",
    description: "ID of the last question the agent asked, e.g. Q7. Empty if no questions were asked.",
    examples: ["S1", "Q7", "D3"],
  },
  {
    type: "string",
    name: "answers_json",
    description:
      "A JSON object mapping each question ID asked to the answer given, " +
      'worded as the matching answer option, e.g. {"S1":"Yes","Q1":"Somewhat agree"}. ' +
      "Use the question IDs from the agent's record_answer calls. Output {} if none.",
    examples: ['{"S1":"Yes","Q1":"Somewhat agree","Q2":"DON\'T KNOW"}'],
  },
  {
    type: "enum",
    name: "respondent_understanding",
    description: "How well the respondent and agent understood each other (accent, hearing, line quality).",
    choices: ["good", "some_difficulty", "poor"],
  },
  {
    type: "boolean",
    name: "interviewer_deviation",
    description:
      "Did the agent paraphrase or reorder a question, suggest an answer, react " +
      "with approval or disapproval, or share an opinion?",
  },
  {
    type: "string",
    name: "deviation_notes",
    description: "What the agent did wrong, briefly.",
    conditional_prompt: "Only fill this if interviewer_deviation is true.",
  },
  {
    type: "string",
    name: "respondent_concerns",
    description: "Any concerns raised about privacy, legitimacy, who is paying, or how the number was obtained.",
    conditional_prompt: "Only fill this if the respondent raised such a concern.",
  },
];

export const WEBHOOK_EVENTS = ["call_started", "call_ended", "call_analyzed"];
