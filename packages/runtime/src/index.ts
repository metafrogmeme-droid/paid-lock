// Written with AI help.
export {
  installPaidLock,
  PaidLockHookError,
  paidLockX402Hooks,
  type Abort,
  type PaidLockX402Hooks,
  type PaidLockX402Options,
  type PaymentCreationContextLike,
  type PaymentRequiredContextLike,
} from "./adapters/x402-client.ts";
export { allows, checkAgainstLock, checkResponse, checkSelected, type FailOn, type LockCheck } from "./check.ts";
export { loadLock, LockLoadError } from "./load.ts";
