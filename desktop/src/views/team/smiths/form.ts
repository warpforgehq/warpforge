import { smithNameError } from "@/lib/smiths";
import type { Smith, SmithDetail, SmithInput, SmithPatch } from "@/protocol";

/** The Smith form's fields, as typed. Numbers stay strings until saved. */
export interface SmithFormValues {
  name: string;
  homeProject: string;
  allowedProjects: string[];
  agent: string;
  model: string | null;
  accountId: string | null;
  usdPerDay: string;
  turnsPerDay: string;
  /** One path prefix per line. */
  writePaths: string;
  push: boolean;
  createPr: boolean;
  soul: string;
  charter: string;
}

export type SmithFormErrors = Partial<Record<keyof SmithFormValues, string>>;

/**
 * @param defaults the project and agent a new teammate starts with
 * @returns a blank form; empty soul and charter start from the daemon's templates
 */
export function emptySmithForm(defaults: { project: string; agent: string }): SmithFormValues {
  return {
    accountId: null,
    agent: defaults.agent,
    allowedProjects: defaults.project ? [defaults.project] : [],
    charter: "",
    createPr: false,
    homeProject: defaults.project,
    model: null,
    name: "",
    push: false,
    soul: "",
    turnsPerDay: "",
    usdPerDay: "",
    writePaths: "",
  };
}

/**
 * @param detail the Smith with its identity files
 * @returns the form showing it
 */
export function smithFormFrom(detail: SmithDetail): SmithFormValues {
  const { smith } = detail;
  return {
    accountId: smith.accountId ?? null,
    agent: smith.agent,
    allowedProjects: smith.allowedProjects,
    charter: detail.charter,
    createPr: smith.permissions.createPr,
    homeProject: smith.homeProject,
    model: smith.model ?? null,
    name: smith.name,
    push: smith.permissions.push,
    soul: detail.soul,
    turnsPerDay: smith.budget.turnsPerDay?.toString() ?? "",
    usdPerDay: smith.budget.usdPerDay?.toString() ?? "",
    writePaths: smith.permissions.writePaths.join("\n"),
  };
}

/**
 * The checks the daemon would refuse on, run before saving. The daemon still
 * decides (ADR 0027 invariant 9).
 * @param values the form
 * @param others every other Smith, for name uniqueness
 * @returns the problems by field; empty when it can be saved
 */
export function validateSmithForm(values: SmithFormValues, others: Smith[]): SmithFormErrors {
  const errors: SmithFormErrors = {};
  const name = smithNameError(values.name.trim(), others);
  if (name) errors.name = name;
  if (!values.homeProject) errors.homeProject = "Pick the smith's home project.";
  if (!values.agent) errors.agent = "Pick an agent.";
  if (values.usdPerDay.trim() && !(Number(values.usdPerDay) > 0)) {
    errors.usdPerDay = "A daily spend limit is a positive amount, or empty for none.";
  }
  const turns = values.turnsPerDay.trim();
  if (turns && !(Number.isInteger(Number(turns)) && Number(turns) > 0)) {
    errors.turnsPerDay = "A daily turn limit is a whole number above 0, or empty for none.";
  }
  if (values.charter.includes("\t")) {
    errors.charter = "YAML does not allow tabs for indentation; use spaces.";
  }
  return errors;
}

function budget(values: SmithFormValues): SmithInput["budget"] {
  const usd = values.usdPerDay.trim();
  const turns = values.turnsPerDay.trim();
  return {
    ...(usd ? { usdPerDay: Number(usd) } : {}),
    ...(turns ? { turnsPerDay: Number(turns) } : {}),
  };
}

function permissions(values: SmithFormValues): SmithInput["permissions"] {
  return {
    createPr: values.createPr,
    push: values.push,
    writePaths: values.writePaths
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean),
  };
}

function allowed(values: SmithFormValues): string[] {
  return [values.homeProject, ...values.allowedProjects.filter((p) => p !== values.homeProject)];
}

/**
 * @param values a valid form
 * @returns the create request; an empty soul or charter is left to the template
 */
export function smithInputFrom(values: SmithFormValues): SmithInput {
  return {
    accountId: values.accountId,
    agent: values.agent,
    allowedProjects: allowed(values),
    budget: budget(values),
    charter: values.charter.trim() ? values.charter : undefined,
    homeProject: values.homeProject,
    model: values.model,
    name: values.name.trim(),
    permissions: permissions(values),
    soul: values.soul.trim() ? values.soul : undefined,
  };
}

/**
 * Only what changed, so an edit does not rewrite identity files it left alone.
 * @param values the edited form
 * @param original the form as it was loaded
 * @returns the update request; `""` clears a model or account
 */
export function smithPatchFrom(values: SmithFormValues, original: SmithFormValues): SmithPatch {
  const patch: SmithPatch = {};
  if (values.name.trim() !== original.name) patch.name = values.name.trim();
  if (values.agent !== original.agent) patch.agent = values.agent;
  if (values.model !== original.model) patch.model = values.model ?? "";
  if (values.accountId !== original.accountId) patch.accountId = values.accountId ?? "";
  if (values.soul !== original.soul) patch.soul = values.soul;
  if (values.charter !== original.charter) patch.charter = values.charter;
  const nextAllowed = allowed(values);
  if (nextAllowed.join("\n") !== allowed(original).join("\n")) patch.allowedProjects = nextAllowed;
  const nextBudget = budget(values);
  if (JSON.stringify(nextBudget) !== JSON.stringify(budget(original))) patch.budget = nextBudget;
  const nextPermissions = permissions(values);
  if (JSON.stringify(nextPermissions) !== JSON.stringify(permissions(original))) {
    patch.permissions = nextPermissions;
  }
  return patch;
}
