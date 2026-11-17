import { KeeperWarning } from "./KeeperWarning";
import { PrFooter } from "./PrFooter";
import { PrForm } from "./PrForm";
import { ReadyKeepers } from "./ReadyKeepers";
import type { useBranchActions } from "./useBranchActions";

export function InlinePrPanel({
  actions,
  taskId,
  onClose,
}: {
  actions: ReturnType<typeof useBranchActions>;
  taskId: string;
  onClose: () => void;
}) {
  const {
    info,
    needsPush,
    prTitle,
    setPrTitle,
    prBody,
    setPrBody,
    setPrBodyEdited,
    prBase,
    setPrBase,
    generatingPr,
    textGenAgentId,
    error,
    generatePr,
  } = actions;
  return (
    <section
      aria-label="Create pull request"
      className="flex min-h-0 flex-1 flex-col overflow-auto"
    >
      <PrForm
        info={info}
        needsPush={needsPush}
        prTitle={prTitle}
        setPrTitle={setPrTitle}
        prBody={prBody}
        setPrBody={(body) => {
          setPrBody(body);
          setPrBodyEdited(true);
        }}
        prBase={prBase}
        setPrBase={setPrBase}
        generatingPr={generatingPr}
        textGenAgentId={textGenAgentId}
        error={error}
        onGenerate={() => void generatePr()}
      />
      <ReadyKeepers {...actions.prKeepers} />
      <KeeperWarning taskId={taskId} />
      <PrFooter
        creatingPr={actions.creatingPr}
        prTitle={prTitle}
        prStep={actions.prStep}
        needsPush={needsPush}
        repositoryOperation={actions.repositoryOperation}
        onBack={onClose}
        onCancel={onClose}
        onCreatePr={() => void actions.createPr()}
      />
    </section>
  );
}
