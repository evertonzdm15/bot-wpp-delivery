import { Ctx, SessionState } from "./types";

export interface Step {
  prompt(ctx: Ctx): Promise<any>;
  handle(ctx: Ctx, text: string): Promise<any>;
  /** Campo opcional: "9" pula (handle recebe string vazia) */
  optional?: boolean;
}

export type Flow = Record<string, Step>;

const flows: Record<string, Flow> = {};

export function registerFlow(name: string, flow: Flow): void {
  flows[name] = flow;
}

export function getStep(flow?: string, step?: string): Step | undefined {
  if (!flow || !step) return undefined;
  return flows[flow]?.[step];
}

/** Navega para uma etapa e envia o prompt. pushStack=false não registra no histórico do "0". */
export async function goTo(ctx: Ctx, flow: string, step: string, pushStack = true): Promise<void> {
  const s = ctx.session;
  if (pushStack && s.flow && s.step && !(s.flow === flow && s.step === step)) {
    s.stack.push({ flow: s.flow, step: s.step });
    if (s.stack.length > 20) s.stack.shift();
  }
  s.flow = flow;
  s.step = step;
  await ctx.save();
  const st = getStep(flow, step);
  if (st) await st.prompt(ctx);
}

/** Comando "0": volta uma etapa. Retorna false se não há histórico. */
export async function goBack(ctx: Ctx): Promise<boolean> {
  const prev = ctx.session.stack.pop();
  if (!prev) return false;
  ctx.session.flow = prev.flow;
  ctx.session.step = prev.step;
  await ctx.save();
  const st = getStep(prev.flow, prev.step);
  if (st) await st.prompt(ctx);
  return true;
}

export function clearFlow(s: SessionState): void {
  s.flow = undefined;
  s.step = undefined;
  s.stack = [];
  s.data = {};
}
