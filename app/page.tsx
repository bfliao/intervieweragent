import { readFileSync } from "fs";
import path from "path";
import QuestionArenaPortal from "@/components/QuestionArenaPortal";
import { scenarioTemplates } from "@/lib/questionArena/scenarios";

export default function Home() {
  const defaultAnswerPrompt = readFileSync(
    path.join(process.cwd(), "prompts", "interview-answerer.md"),
    "utf8"
  );
  const defaultEvaluatorPrompt = readFileSync(
    path.join(process.cwd(), "prompts", "evaluator.md"),
    "utf8"
  );

  return (
    <main>
      <QuestionArenaPortal
        scenarios={scenarioTemplates}
        defaultAnswerPrompt={defaultAnswerPrompt}
        defaultEvaluatorPrompt={defaultEvaluatorPrompt}
      />
    </main>
  );
}
