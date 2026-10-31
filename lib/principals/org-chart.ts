// Ownership chart: who owns the borrower, directly and through upper-tier
// entities. Effective ownership multiplies shares down the chain (a 50% member
// of an LLC that owns 60% of the borrower holds 30% of the borrower), which is
// what the program thresholds (SBA 20%, HUD and agency 25%) look at.

import { CONTROL_ROLES, type Principal } from "./types";

export type OrgNode = {
  principal: Principal;
  children: OrgNode[];
  /** Effective share of the borrower (0–100). The borrower itself is 100. */
  effectivePct: number;
  depth: number;
  /** Holds a control role (managing member, GP, officer, director, trustee) anywhere in the chain. */
  controlling: boolean;
};

export type OrgChart = {
  root: OrgNode | null;
  /** Every principal reachable from the borrower, keyed by id. */
  nodes: Map<string, OrgNode>;
  /** Principals not connected to the borrower (missing or broken parent links). */
  orphans: Principal[];
  issues: string[];
};

const TOLERANCE = 0.01;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function buildOrgChart(principals: readonly Principal[]): OrgChart {
  const issues: string[] = [];
  const byId = new Map(principals.map((p) => [p.id, p]));
  const roots = principals.filter((p) => p.roles.includes("borrower_entity"));
  if (roots.length === 0) issues.push("No borrowing entity is on file; add the borrower before its owners.");
  if (roots.length > 1) issues.push(`More than one borrowing entity is on file (${roots.map((r) => r.legalName).join(", ")}).`);

  const childrenOf = new Map<string, Principal[]>();
  for (const p of principals) {
    if (!p.parentId) continue;
    const parent = byId.get(p.parentId);
    if (!parent) {
      issues.push(`${p.legalName}: its parent entity is not on this deal.`);
      continue;
    }
    if (parent.kind !== "entity") issues.push(`${p.legalName}: ${parent.legalName} is an individual and cannot have owners.`);
    if (parent.dealId !== p.dealId) issues.push(`${p.legalName}: its parent entity belongs to another deal.`);
    const list = childrenOf.get(parent.id) ?? [];
    list.push(p);
    childrenOf.set(parent.id, list);
  }

  for (const [parentId, kids] of childrenOf) {
    const parent = byId.get(parentId)!;
    const total = kids.reduce((s, k) => s + (k.ownershipPct ?? 0), 0);
    if (total > 100 + TOLERANCE) issues.push(`${parent.legalName}: owners add up to ${round4(total)}%, more than 100%.`);
    for (const k of kids) {
      if (k.ownershipPct === null && !k.roles.some((r) => CONTROL_ROLES.includes(r) || r === "operator" || r === "management_agent" || r === "guarantor")) {
        issues.push(`${k.legalName}: enter an ownership percentage or a control role.`);
      }
    }
  }

  const nodes = new Map<string, OrgNode>();
  const root = roots[0];
  let rootNode: OrgNode | null = null;
  if (root) {
    const visit = (p: Principal, effectivePct: number, depth: number, controlling: boolean, path: Set<string>): OrgNode => {
      const node: OrgNode = { principal: p, children: [], effectivePct: round4(effectivePct), depth, controlling };
      nodes.set(p.id, node);
      for (const child of childrenOf.get(p.id) ?? []) {
        if (path.has(child.id)) {
          issues.push(`${child.legalName}: ownership loops back on itself.`);
          continue;
        }
        if (nodes.has(child.id)) continue;
        const share = (child.ownershipPct ?? 0) / 100;
        const childControls = child.roles.some((r) => CONTROL_ROLES.includes(r));
        // Control passes down: the managing member of the managing member controls the borrower.
        node.children.push(visit(child, effectivePct * share, depth + 1, childControls && (depth === 0 || controlling), new Set([...path, child.id])));
      }
      return node;
    };
    rootNode = visit(root, 100, 0, true, new Set([root.id]));
  }

  const orphans = principals.filter((p) => !nodes.has(p.id) && !(roots.length > 1 && roots.includes(p)));
  for (const o of orphans) if (!issues.some((i) => i.startsWith(`${o.legalName}:`))) issues.push(`${o.legalName}: not connected to the borrower.`);
  return { root: rootNode, nodes, orphans, issues };
}

/** Flattens the chart depth-first for display (indent by `depth`). */
export function flattenChart(chart: OrgChart): OrgNode[] {
  const out: OrgNode[] = [];
  const walk = (n: OrgNode) => {
    out.push(n);
    for (const c of [...n.children].sort((a, b) => b.effectivePct - a.effectivePct)) walk(c);
  };
  if (chart.root) walk(chart.root);
  return out;
}

/** Aggregate effective ownership per individual (one person may hold through several entities). */
export function individualOwnership(chart: OrgChart): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of chart.nodes.values()) {
    if (n.principal.kind !== "individual") continue;
    out.set(n.principal.id, round4((out.get(n.principal.id) ?? 0) + n.effectivePct));
  }
  return out;
}
