/**
 * Token-savings benchmark for the OFFLINE rewrite path (deterministic, no network).
 * Runs the real engine over representative prompts and reports before/after token
 * counts, % saved, quality-score change, and Copilot-credit (AIC) impact.
 *
 * This isolates the part of savings we can measure objectively without a live model.
 * The LLM rewrite path is measured in the running extension (see the strategy notes).
 */
import { estimateTokens, estimateCredits, scorePrompt } from '@tokentama/scoring-engine';
import { leanRewrite } from '@tokentama/llm-adapters';

interface Scenario {
  name: string;
  prompt: string;
}

const scenarios: Scenario[] = [
  {
    name: 'Politeness + verbosity',
    prompt:
      "Hey there! Could you please, if it's not too much trouble, kindly help me out by " +
      'refactoring the validateEmail function in src/utils/validation.ts so that it uses a ' +
      'single regular expression and returns a typed Result object instead of a boolean? ' +
      'Thank you so much in advance, I really appreciate your help with this!',
  },
  {
    name: 'Re-pasted / redundant context',
    prompt:
      'I have a React component called UserCard in src/components/UserCard.tsx. ' +
      'It renders a name and an avatar. I want to add a loading skeleton. ' +
      'Again, the component is UserCard in src/components/UserCard.tsx, it renders a name ' +
      'and an avatar, and I want to add a loading skeleton state to it please.',
  },
  {
    name: 'Rambling multi-ask',
    prompt:
      'So basically what I am trying to do here, and I might be overthinking this a bit, is ' +
      'that I kind of want to maybe add some sort of caching to the getUser function, you know, ' +
      'so that it does not hit the database every single time, and also it would be nice if ' +
      'perhaps we could log something when there is a cache hit or miss, if that makes sense.',
  },
  {
    name: 'Vague (little to compress)',
    prompt: 'fix the login bug',
  },
  {
    name: 'Already lean (control)',
    prompt: 'Add a unit test for parseEmail covering empty, valid, and malformed input.',
  },
];

function pct(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round((1 - after / before) * 100);
}

function score(text: string): number {
  const resp = scorePrompt({
    sessionId: 'bench',
    userId: 'local',
    promptText: text,
    metadata: { promptLengthChars: text.length },
  });
  return Math.round(resp.overallScore);
}

let totalBefore = 0;
let totalAfter = 0;

console.log('\n=== Tokentama offline rewrite — token-savings benchmark ===\n');
for (const s of scenarios) {
  const before = s.prompt.trim();
  const after = leanRewrite(before).trim();
  const tb = estimateTokens(before);
  const changed = after !== before && after.length < before.length;
  const ta = changed ? estimateTokens(after) : tb;
  totalBefore += tb;
  totalAfter += ta;

  console.log(`• ${s.name}`);
  console.log(`  before: ${tb} tok  (score ${score(before)})`);
  if (changed) {
    console.log(`  after:  ${ta} tok  (score ${score(after)})   saved ${tb - ta} tok / ${pct(tb, ta)}%`);
    console.log(`  rewrite: ${after}`);
  } else {
    console.log('  after:  no leaner rewrite surfaced (correctly left as-is)');
  }
  console.log('');
}

const saved = totalBefore - totalAfter;
// Input-side credit impact using the built-in default model rates.
const creditsBefore = estimateCredits(totalBefore, 0);
const creditsAfter = estimateCredits(totalAfter, 0);

console.log('--- Session totals (these 5 prompts) ---');
console.log(`input tokens:  ${totalBefore} -> ${totalAfter}   saved ${saved} (${pct(totalBefore, totalAfter)}%)`);
console.log(
  `input credits: ${creditsBefore.toFixed(3)} -> ${creditsAfter.toFixed(3)} AIC   ` +
    `saved ${(creditsBefore - creditsAfter).toFixed(3)} AIC`,
);
console.log('');

// ---------------------------------------------------------------------------
// Extended test: long, realistic multi-turn coding conversations.
//
// Each turn is scored + rewritten (offline). We report two savings figures:
//   1) Compression  — measured: fewer INPUT tokens per turn (deterministic).
//   2) Retry-avoided — modeled: a vague turn triggers a re-ask that re-sends a
//      whole turn (input + a typical reply). Landing first-try removes it.
// Output size is model-driven (not changed by phrasing), so we model it with a
// fixed representative reply so credits reflect whole turns, not just prompts.
// ---------------------------------------------------------------------------

const REPLY_TOKENS = 320; // representative assistant reply per turn

type Kind = 'normal' | 'retry';
interface Turn {
  text: string;
  kind?: Kind;
}
interface Conversation {
  title: string;
  turns: Turn[];
}

const conversations: Conversation[] = [
  {
    title: 'A · Auth feature (politeness, a re-paste, two retries)',
    turns: [
      { text: 'Hey! Could you please help me scaffold a login form component in React at src/components/LoginForm.tsx with email and password fields? Thanks a lot!' },
      { text: 'Now, if it is not too much trouble, add client-side validation to LoginForm.tsx: email must be a valid address and password at least 8 characters.' },
      { text: 'Wire the submit handler to POST to /api/login using fetch and show an error message on a 401 response.' },
      { text: 'It is still not working, try again, the error message does not show up when the login fails.' , kind: 'retry' },
      { text: 'The 401 branch never runs because fetch does not throw on 401 — check response.ok in the submit handler in src/components/LoginForm.tsx and render the error when it is false.' },
      { text: 'Add a loading state to the submit button so it is disabled and shows a spinner while the request is in flight.' },
      { text: 'Could you kindly also add a "remember me" checkbox that stores the email in localStorage, thank you so much!' },
      { text: 'Just to repeat, the component is LoginForm.tsx, it has email and password fields and a submit handler, and I now want a remember-me checkbox that persists the email in localStorage.', kind: 'normal' },
      { text: 'Extract the fetch call into a useLogin hook in src/hooks/useLogin.ts that returns { login, loading, error }.' },
      { text: 'still broken, same as before, the loading flag stays true after an error', kind: 'retry' },
      { text: 'In useLogin.ts, set loading to false inside a finally block so it resets on both success and error.' },
      { text: 'Write a unit test for useLogin covering success, a 401, and a network error using vitest and msw.' },
      { text: 'Add a data-testid to the error element in LoginForm.tsx so the tests can query it.' },
      { text: 'Please, when you get a chance, add JSDoc to the useLogin hook describing its return shape. No rush, thanks!' },
    ],
  },
  {
    title: 'B · Bug hunt (vague asks that cause retries)',
    turns: [
      { text: 'the checkout page is broken, can you fix it?' },
      { text: 'still not working', kind: 'retry' },
      { text: 'The checkout page at src/pages/Checkout.tsx throws "cannot read properties of undefined (reading total)" when the cart is empty — guard against an empty cart before reading cart.total.' },
      { text: 'ok now the totals are wrong', kind: 'retry' },
      { text: 'In Checkout.tsx the order total is summing price but ignoring quantity — multiply price by quantity for each line item in the computeTotal function.' },
      { text: 'the tax is off too', kind: 'retry' },
      { text: 'computeTotal in Checkout.tsx applies tax before the quantity multiplication — apply the 8.25% tax to the post-quantity subtotal instead.' },
      { text: 'Add a memoized selector so computeTotal does not recalculate on every render; use useMemo keyed on the cart items.' },
      { text: 'Now write a test in Checkout.test.tsx for an empty cart, a single item, and multiple quantities.' },
      { text: 'the empty cart test fails', kind: 'retry' },
      { text: 'The empty-cart test fails because computeTotal returns NaN for an empty array — return 0 when there are no items.' },
      { text: 'Add a currency formatter util in src/utils/format.ts that renders cents as $X.XX and use it for the displayed total.' },
    ],
  },
  {
    title: 'C · Refactor sprint (verbose, rambling requests)',
    turns: [
      { text: 'So basically what I want to do here, and I might be overcomplicating this, is kind of clean up the UserService class in src/services/UserService.ts because it is sort of a mess, you know?' },
      { text: 'Extract the database access in UserService into a UserRepository class in src/services/UserRepository.ts so the service only holds business logic.' },
      { text: 'I was wondering if you could maybe convert the callback-based methods in UserRepository to async/await, if possible, thanks!' },
      { text: 'Replace the manual SQL string concatenation in UserRepository with parameterized queries to fix the SQL injection risk.' },
      { text: 'Add a caching layer: cache getUserById results in memory for 60 seconds and invalidate on updateUser.' },
      { text: 'the cache does not invalidate', kind: 'retry' },
      { text: 'In UserRepository.updateUser, delete the cache entry for that user id after a successful write so getUserById re-fetches.' },
      { text: 'Now add structured logging around each repository method using the existing logger from src/lib/logger.ts, logging the method name and duration.' },
      { text: 'Kindly split UserService into UserService and UserProfileService since it is doing two jobs, thank you!' },
      { text: 'Update the DI container in src/container.ts to register UserRepository, UserService, and UserProfileService.' },
      { text: 'Write integration tests for UserRepository against an in-memory sqlite database covering create, read, update, and delete.' },
      { text: 'Add TSDoc comments to every public method on UserService describing parameters and return types.' },
      { text: 'Finally, run a pass to remove any now-unused imports and dead code across the files we touched.' },
    ],
  },
];

function turnCredits(inputTokens: number, replyTokens: number): number {
  return estimateCredits(inputTokens, replyTokens);
}

let grandBefore = 0;
let grandAfter = 0;

console.log('=== Extended test — long simulated conversations ===\n');
for (const convo of conversations) {
  let inBefore = 0;
  let inAfterAll = 0;
  let turns = 0;
  let retries = 0;
  let inAfterKept = 0; // input tokens for turns that survive when retries are avoided
  let keptTurns = 0;

  for (const t of convo.turns) {
    turns += 1;
    const before = estimateTokens(t.text);
    const rw = leanRewrite(t.text).trim();
    const compressed = rw !== t.text.trim() && rw.length < t.text.trim().length;
    const after = compressed ? estimateTokens(rw) : before;
    inBefore += before;
    inAfterAll += after;
    if (t.kind === 'retry') {
      retries += 1;
    } else {
      inAfterKept += after;
      keptTurns += 1;
    }
  }

  // Whole-turn tokens (input + a representative reply per turn).
  const fullBefore = inBefore + turns * REPLY_TOKENS;
  // Treatment: prompts are compressed AND clearer prompts avoid the re-asks.
  const fullAfter = inAfterKept + keptTurns * REPLY_TOKENS;
  const compressPct = pct(inBefore, inAfterAll);

  const cBefore = turnCredits(inBefore, turns * REPLY_TOKENS);
  const cAfter = turnCredits(inAfterKept, keptTurns * REPLY_TOKENS);

  grandBefore += fullBefore;
  grandAfter += fullAfter;

  console.log(`• ${convo.title}`);
  console.log(`  turns: ${turns}  (retries/re-asks: ${retries})`);
  console.log(`  prompt compression: ${inBefore} -> ${inAfterAll} input tok  (${compressPct}% leaner prompts)`);
  console.log(
    `  whole-session tokens: ${fullBefore} -> ${fullAfter}   ` +
      `saved ${fullBefore - fullAfter} (${pct(fullBefore, fullAfter)}%)  [compression + ${retries} retries avoided]`,
  );
  console.log(`  credits: ${cBefore.toFixed(2)} -> ${cAfter.toFixed(2)} AIC   saved ${(cBefore - cAfter).toFixed(2)} AIC`);
  console.log('');
}

const gcBefore = estimateCredits(grandBefore, 0);
const gcAfter = estimateCredits(grandAfter, 0);
console.log('--- All conversations combined ---');
console.log(
  `whole-session tokens: ${grandBefore} -> ${grandAfter}   ` +
    `saved ${grandBefore - grandAfter} (${pct(grandBefore, grandAfter)}%)`,
);
console.log(`credits (billed unit): ${gcBefore.toFixed(2)} -> ${gcAfter.toFixed(2)} AIC   saved ${(gcBefore - gcAfter).toFixed(2)} AIC`);
console.log(
  '\nNote: prompt compression is measured deterministically; retry-avoidance is modeled\n' +
    `(a typical ${REPLY_TOKENS}-token reply per turn) and depends on the rewrite actually\n` +
    'preventing the re-ask — validate that live via the Outcomes panel and Export pilot data.\n',
);

