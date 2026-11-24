// A fixed, labelled benchmark for the semantic ranking engine: one reader profile and one
// candidate pool, so every engine change is scored the same way. The labels are editorial —
// `relevant: true` means this reader would want that story in the digest — which is the point:
// the harness measures the engine against a judgement, not against its own output.
import type { SemanticCandidate, SemanticVoteExample } from '../../lib/ranking.ts';

export const EVAL_NOW = Date.UTC(2026, 10, 24, 7, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface EvalCandidate extends SemanticCandidate {
  relevant: boolean;
  source: string;
  folder: string;
  publishedAtMs: number;
}

const vote = (
  id: string,
  kind: 'like' | 'dislike',
  title: string,
  text: string,
  ageDays: number,
): SemanticVoteExample => ({
  id,
  vote: kind,
  title,
  text,
  timestamp: EVAL_NOW - ageDays * DAY,
});

export const EVAL_PROFILE: SemanticVoteExample[] = [
  // AI policy and safety.
  vote('l1', 'like', 'Brussels drafts AI liability rules', 'ai liability rules model providers compliance enforcement brussels', 1),
  vote('l2', 'like', 'Model safety testing becomes mandatory', 'model safety testing mandatory frontier labs evaluations red teaming', 3),
  vote('l3', 'like', 'Open weights debate reaches Washington', 'open weights policy model release licensing washington', 5),
  // Rust and systems programming.
  vote('l4', 'like', 'Borrow checker lessons from a rewrite', 'rust borrow checker ownership memory safety rewrite compiler', 7),
  vote('l5', 'like', 'Async runtimes compared', 'rust async runtime tokio executor futures performance', 9),
  vote('l6', 'like', 'Zero-copy parsing in practice', 'rust zero copy parser lifetimes memory performance', 12),
  // Bread baking.
  vote('l7', 'like', 'A drier starter for better loaves', 'sourdough starter hydration flour fermentation loaf oven', 14),
  vote('l8', 'like', 'Shaping wet dough by hand', 'dough shaping hydration flour gluten loaf baking', 17),
  vote('l9', 'like', 'Why your crumb is gummy', 'crumb gummy sourdough fermentation flour baking loaf', 20),
  // Crypto speculation, disliked.
  vote('d1', 'dislike', 'Token airdrop season returns', 'token airdrop crypto wallet yield farming speculation', 2),
  vote('d2', 'dislike', 'Memecoin pumps and influencer wallets', 'memecoin influencer crypto prices speculation', 6),
  vote('d3', 'dislike', 'Another crypto lender halts withdrawals', 'crypto lender withdrawals custody speculation', 11),
];

let index = 0;
const story = (
  id: string,
  source: string,
  folder: string,
  title: string,
  summary: string,
  relevant: boolean,
  body = '',
): EvalCandidate => {
  index += 1;
  return {
    id,
    title,
    summary,
    fullText: body || undefined,
    source,
    folder,
    relevant,
    publishedAtMs: EVAL_NOW - (index % 12) * HOUR,
  };
};

// [thin, full] pairs. The reader wants the piece with something behind it; the pair metric asks
// whether the engine agrees. Each pair is the same story twice: the headline alone, and the
// headline with the body that earns it. Cosine similarity alone gets this wrong, because the body
// dilutes the vector and the headline does not, so the pairs are where a length fix shows up.
export const EVAL_PAIRS: Array<[string, string]> = [
  ['p43', 'p44'],
  ['p45', 'p46'],
  ['p47', 'p48'],
  ['p49', 'p50'],
  ['p51', 'p52'],
  ['p53', 'p54'],
];

export const EVAL_POOL: EvalCandidate[] = [
  // Four stories per liked topic: the readers' actual interests.
  story('p1', 'Policy Desk', 'Policy', 'AI Act compliance deadlines tighten', 'Model providers face documentation duties under the AI Act', true),
  story('p2', 'Safety Lab', 'Policy', 'Frontier labs agree to safety evaluations', 'Red teaming and model evaluation reporting expand', true),
  story('p3', 'Senate Wire', 'Policy', 'Senate weighs open-weight licensing', 'Model release rules debated in Washington', true),
  story('p4', 'Brussels Beat', 'Policy', 'Providers brace for liability rules', 'AI liability and compliance enforcement in Brussels', true),
  story('p5', 'Rust Weekly', 'Systems', 'Ownership rules that catch real bugs', 'Borrow checker lessons from production Rust', true),
  story('p6', 'Async Notes', 'Systems', 'Choosing an async runtime', 'Tokio and executor performance compared', true),
  story('p7', 'Parser Log', 'Systems', 'Zero-copy parsing with lifetimes', 'Rust parser lifetimes and memory performance', true),
  story('p8', 'Compiler Room', 'Systems', 'When the borrow checker says no', 'Ownership and memory safety trade-offs in Rust', true),
  story('p9', 'Bake Notes', 'Baking', 'Hydration maths for sourdough', 'Flour, water and fermentation timing', true),
  story('p10', 'Dough Diary', 'Baking', 'Shaping high-hydration dough', 'Gluten development and loaf shaping', true),
  story('p11', 'Crumb Lab', 'Baking', 'Fixing a gummy crumb', 'Fermentation and baking adjustments', true),
  story('p12', 'Starter Club', 'Baking', 'Starter maintenance in winter', 'Feeding schedule for a sourdough starter', true),

  // Everything below is off-topic for this reader. Several are deliberately close in vocabulary
  // (chips, datacentres, token markets) so the harness can catch a ranker that matches words
  // rather than subjects.
  story('p13', 'Wire', 'Business', 'Chip export controls broaden', 'Semiconductor supply and datacentre hardware', false),
  story('p14', 'Grid Report', 'Business', 'Datacentre power demand strains grids', 'Utilities weigh tariffs as compute clusters expand', false),
  story('p15', 'Market Desk', 'Business', 'GPU resale prices cool', 'Second-hand accelerator listings fall', false),
  story('p16', 'Home Weekly', 'Design', 'A field guide to office chairs', 'Lumbar support, mesh and adjustability', false),
  story('p17', 'Run Club', 'Sport', 'Marathon training on limited miles', 'Building endurance without wrecking your knees', false),
  story('p18', 'Sky Notes', 'Science', 'Telescope spots a distant quasar', 'Astronomers trace light from the early universe', false),
  story('p19', 'Health Desk', 'Health', 'Sleep and shift work', 'Recovery and light exposure for night shifts', false),
  story('p20', 'Rates Wire', 'Markets', 'Bond markets price in slower cuts', 'Yield curves shift after central bank minutes', false),
  story('p21', 'Type Journal', 'Design', 'A quiet case for better typography', 'Grids, measure and rhythm in long-form layouts', false),
  story('p22', 'Field Notes', 'Climate', 'Rewilding a Scottish glen', 'Native woodland returns after decades of grazing', false),
  story('p23', 'Book Desk', 'Culture', 'The novel that changed criticism', 'A rereading of a mid-century classic', false),
  story('p24', 'Rail Review', 'Travel', 'Night trains across the Alps', 'Sleeper routes return to European timetables', false),
  story('p25', 'Pressings', 'Culture', 'Why vinyl keeps selling', 'Pressing plants and the economics of reissues', false),
  story('p26', 'Soil Notes', 'Climate', 'Soil carbon and cover crops', 'Farm trials measure what stays in the ground', false),
  story('p27', 'Sport Wire', 'Sport', 'A test captain steps down', 'Selectors turn to youth after a series defeat', false),
  story('p28', 'Token Desk', 'Markets', 'Token unlocks loom over exchanges', 'Supply schedules and market liquidity', false),
  story('p29', 'Chain Notes', 'Markets', 'Airdrop farming guides proliferate', 'Wallets chase points before a token launch', false),
  story('p30', 'Exchange Wire', 'Business', 'Exchange outage strands traders', 'Withdrawals pause during a custody migration', false),
  story('p31', 'Payments Desk', 'Markets', 'Stablecoin reserves under review', 'Attestations and treasury holdings questioned', false),
  story('p32', 'Table Talk', 'Food', 'Restaurant reviews: the new bistro', 'Small plates and a short wine list', false),
  story('p33', 'Archive', 'Culture', 'A history of the bicycle', 'From draisines to derailleurs', false),
  story('p34', 'Board Notes', 'Games', 'Chess engines and human intuition', 'What calculation still misses', false),
  story('p35', 'Air Desk', 'Health', 'Wildfire smoke and air quality', 'Filters, masks and indoor readings', false),
  story('p36', 'Civic Wire', 'Policy', 'Municipal budgets squeeze libraries', 'Hours cut as levies fail', false),

  // Hard positives: on-topic for this reader, but written without the words their votes happen
  // to use. A ranker that only matches vocabulary misses these.
  story('p37', 'Audit Desk', 'Policy', 'Model audits and disclosure duties', 'Providers document training data and risk assessments', true),
  story('p38', 'Systems Notes', 'Systems', 'Lifetimes without the fear', 'Memory safety guarantees in systems languages', true),
  story('p39', 'Crumb Lab', 'Baking', 'Open crumb, explained', 'Gluten networks and steam in a hot oven', true),

  // Adversarial negatives: the reader's words, the wrong subject.
  story('p40', 'Ad Desk', 'Business', 'AI-generated marketing copy soars', 'Brands automate ad text and product blurbs', false),
  story('p41', 'Garage Notes', 'Hobby', 'Rust on the hull: restoring a vintage car', 'Corrosion, primer and paintwork', false),
  story('p42', 'Kitchen Tests', 'Food', 'The best bread machines', 'Appliance tests, timers and non-stick pans', false),

  // Thin-versus-full pairs: the same story as a bare headline and as a piece with something to
  // read. The reader wants the full one; a ranker that counts headline overlap and ignores how
  // much article is behind it prefers the stub. This is the pair that gives the benchmark
  // headroom, because no current weight distinguishes the two.
  story('p43', 'Policy Wire', 'Policy', 'Deadline squeeze hits AI providers', '', false),
  story('p44', 'Policy Desk', 'Policy', 'Deadline squeeze hits AI providers across Europe', '', true,
    'Member states must file risk assessments before deployment, name a responsible officer and keep model documentation for audits. Providers say the liability timetable is tight, while regulators argue the compliance deadlines were published a year ago and the paperwork is proportionate to the risk.'),
  story('p45', 'Compiler Room', 'Systems', 'Ownership lessons from a compiler rewrite', '', false),
  story('p46', 'Rust Weekly', 'Systems', 'Ownership lessons from a compiler rewrite, in detail', '', true,
    'The rewrite moved ownership rules into the type system and removed a class of aliasing bugs. The team describes splitting borrows, returning iterators without unsafe blocks, and the two places where lifetimes still leak into public APIs, with the memory safety trade-offs each one forces.'),
  story('p47', 'Starter Club', 'Baking', 'Feeding schedules that actually work', '', false),
  story('p48', 'Bake Notes', 'Baking', 'Feeding schedules that actually work, measured', '', true,
    'Weigh the sourdough starter, flour and water separately, then vary hydration in five percent steps and note the rise time at a fixed oven temperature. A wetter starter ferments faster but collapses sooner, which changes the feeding schedule more than the recipe does, and the loaf crumb shows it.'),

  // Three more pairs on the reader's own subjects, so the number rests on six stories rather than
  // three and one unlucky pair cannot carry it.
  story('p49', 'Policy Wire', 'Policy', 'Open-weight licensing closes in', '', false),
  story('p50', 'Policy Desk', 'Policy', 'Open-weight licensing closes in, with caveats', '', true,
    'Providers publishing weights must ship a model card, name a contact for regulator queries and keep evaluation results for three years. Smaller labs say the paperwork outweighs the risk for narrow models, while officials argue the timetable was known and the duties scale with capability.'),
  story('p51', 'Async Notes', 'Systems', 'Async runtimes on a budget', '', false),
  story('p52', 'Rust Weekly', 'Systems', 'Async runtimes on a budget, measured', '', true,
    'Two runtimes were measured on the same service: throughput per core, tail latency under load, and how quickly each shed work when the executor saturated. The difference sat in the scheduler rather than the syntax, and both needed the same care around blocking calls inside async handlers.'),
  story('p53', 'Starter Club', 'Baking', 'Starter ratios that survive a heatwave', '', false),
  story('p54', 'Bake Notes', 'Baking', 'Starter ratios that survive a heatwave, tested', '', true,
    'Three feeding ratios went through a hot week: one to one, one to two, and a stiff levain. The stiff starter held its rise longest and soured slowly, while the wet one peaked fast and then collapsed, so the feeding schedule mattered more than the dough hydration did.'),
];
