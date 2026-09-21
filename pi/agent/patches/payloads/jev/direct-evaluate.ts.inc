import type { Experimental_EvaluationQuestion, Experimental_EvaluationResult } from "ai";

type Question = Extract<Experimental_EvaluationQuestion, { type: "choice" | "boolean" }>;
type Result<Q extends Record<string, Question>> = {
  answers: Experimental_EvaluationResult<Q>["answers"];
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Direct TypeSafe transport. The router owns deadlines, retries and fallback. */
export async function evaluate<const Q extends Record<string, Question>>({ state, questions, abortSignal }: {
  state: unknown;
  questions: Q;
  abortSignal?: AbortSignal;
}): Promise<Result<Q>> {
  abortSignal?.throwIfAborted();
  const apiKey = process.env.JEV_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing JEV_API_KEY in Pi's environment.");

  // AI SDK boolean questions are called "noul" by TypeSafe's direct API.
  const directQuestions = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type !== "choice" && question.type !== "boolean") throw new Error("Unsupported Jev question type.");
    return [id, { ...question, type: question.type === "boolean" ? "noul" : "choice" }];
  }));

  let response: Response;
  try {
    response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state, questions: directQuestions }),
      signal: abortSignal,
      redirect: "error",
    });
  } catch {
    abortSignal?.throwIfAborted();
    throw new Error("Jev direct request failed.");
  }

  // Never expose response bodies or fetch errors: they may echo task text or keys.
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Jev request failed (HTTP ${response.status}).`), { statusCode: response.status });
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    abortSignal?.throwIfAborted();
    throw new Error("Invalid Jev JSON response.");
  }
  abortSignal?.throwIfAborted();
  if (!isRecord(data) || !isRecord(data.answers)) throw new Error("Invalid Jev response.");

  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = data.answers[id];
    if (!isRecord(answer)) throw new Error("Missing Jev answer.");
    if (question.type === "boolean") {
      if (answer.type !== "noul" || !isProbability(answer.noul)) throw new Error("Invalid Jev boolean answer.");
      answers[id] = { type: "boolean", probability: answer.noul };
    } else {
      const probabilities = answer.probabilities;
      if (answer.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice) ||
          !isRecord(probabilities) || Object.keys(probabilities).length !== Object.keys(question.criteria).length ||
          Object.keys(question.criteria).some(key => !Object.hasOwn(probabilities, key) || !isProbability(probabilities[key]))) {
        throw new Error("Invalid Jev choice answer.");
      }
      answers[id] = { type: "choice", choice: answer.choice, probabilities };
    }
  }

  // Missing/invalid usage remains unknown so the router marks its estimate incomplete.
  const usage = isRecord(data.usage) ? data.usage : {};
  const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return {
    answers: answers as Result<Q>["answers"],
    usage: { inputTokens: tokens(usage.input_tokens), outputTokens: tokens(usage.output_tokens) },
  };
}
