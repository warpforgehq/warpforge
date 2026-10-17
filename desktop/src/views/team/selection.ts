/** What the Team view's main area shows. */
export type TeamSelection =
  | { kind: "conversation"; key: string }
  | { kind: "teammate"; id: string; editing?: boolean }
  | { kind: "newTeammate" };
