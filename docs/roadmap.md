# Commercial roadmap

Goal: operate a sustainable multiplayer card service and earn profit after payment,
infrastructure, content, acquisition, support, and operator labor costs. This is a
prioritized decision guide, not a commitment to build every idea. Temporary execution
plans belong in Git-ignored `.plan/`.

## Scope and recommendation

Confirmed first-release scope: Taiwan first, operated as a web service. Mobile store
distribution is a later investment, not a first-release requirement. A small operating
team and no wagering for money or transferable value remain planning assumptions;
staffing and budget still require owner decisions. Deployment, public operation,
charging customers, and mobile store release have different acceptance gates.

Start with **recurring private tables for friend groups and clubs**: Taiwanese rules,
easy invitations, reliable mobile sessions, and social play. Choose one or two existing
games as the acquisition focus through pilot use; keep other games available without
creating nine separate matching queues. Validate return visits and willingness to pay
before investing in unrestricted stranger discovery, more games, or native apps.
Bridge learning and organized club play are an alternative specialization with more
instructional, scoring, and tournament work.

This is a product hypothesis, not measured market demand. Interview hosts, observe
complete sessions, compare the alternatives they actually use, and test a concrete
paid offer. Feature requests and registrations alone do not demonstrate willingness
to pay. Each experiment needs an owner, spending ceiling, evaluation window, and
advance/stop criteria agreed before implementation.

## Verified baseline and remaining gaps

Repository assessment: 2026-10-14. Deployment is documented; live capacity, backup
execution, usage, commercial asset rights, and revenue were not audited. The linked
guides remain authoritative for current behavior.

| Area | Implemented | Remaining work |
| --- | --- | --- |
| Games | Nine games, bots, timers, restart recovery; Ninety-Nine, Blackjack, and Hold'em support 2–8 occupied seats ([rules](games.md)) | Public-table fairness, mobile interruptions, onboarding, bot levels, standardized competitive rules |
| Accounts | Password hashing, opaque sessions, revocation, Origin validation and rate limits ([identity](storage.md#identity-and-sessions)) | Recoverable identity, self-service recovery, account/data requests, legal pages and versioned consent |
| Social | Friends, invitations, durable private messages, in-app notifications and voice listening controls ([storage](storage.md#direct-messages-and-notifications), [voice](media.md#voice)) | Reporting, blocking, durable sanctions, operator permissions/audit and abuse response across channels |
| Discovery | Room codes, friend-room joining and authenticated room deep links ([interface](interface.md#lobby-and-friends)) | Public landing pages, copy/share invitation URLs, intentional mobile game selection; public matching after demand and safety readiness |
| Cosmetics | Earned coins, official shop, permanent ownership, atomic coin purchases and equipment validation ([inventory](storage.md#cosmetic-inventory)) | Real-money orders, payment verification/reconciliation, refunds and paid entitlement lifecycle |
| Storage | Serialized, validated, fsynced temporary-file replacement; runtime/history/rewards commit together ([database](storage.md#database)) | Whole-file write cost, growing records/media, cross-process ownership protection and transactional billing storage |
| Operations | Deploy locks, rollback procedures, systemd hardening, health route and same-host daily snapshots ([deployment](deployment.md)) | Off-host copies and restore evidence, alerts/readiness, incidents/support coverage, measured capacity and recurring costs |
| Media | Upload quotas, content-addressed files, original official SVG cosmetics, optional WebRTC ([media](media.md)) | Rights register, safe decoding, review/removal, retention/cleanup, cross-network voice verification and relay cost control |

JSON already provides atomic whole-file commits, but no general SQL transactions or
horizontal room coordination. A capped free pilot does not automatically require SQL.
Paid billing needs a reviewed durable transaction design, preferably the
[SQL adapter](storage.md#future-sql-adapter). SQL alone does not make a stateful game
server safe across multiple processes.

## Product and revenue constraints

- Keep gameplay, legal moves, timers, and competitive outcomes independent of payment.
- Separate match chips from account coins. Coins reward completion, not winning.
  Neither may be bought, transferred, cashed out, staked for valuable prizes, or used
  to facilitate external wagering. These constraints do not establish legal clearance.
- Sell directly priced products or subscriptions; no paid random rewards at launch.
  Paid rights are server-authoritative and separate from earned-coin balances.
- Preserve earned cosmetic ownership and durable product IDs. Define free/paid catalogs
  before selling; do not retroactively revoke earned purchases.
- Preserve existing free uploads by default. Differentiate through original design,
  convenience, social visibility, and service value. Any upload restriction or free
  benefit change requires an explicit owner decision and clear transition policy.
- Before stranger play, prevent unrevealed hands from reaching spectators or eliminated
  players on the server. UI hiding and separate chat/voice channels cannot prevent
  collusion through external communication.
- Recovery, security, reporting and data-rights requests stay accessible to free players.
  Review safe history/privacy defaults before acquiring unfamiliar users.

## Launch stages and acceptance gates

Backlog IDs below track future work. P0 blocks the stated stage; P1 follows once that
stage is safe; P2 depends on demonstrated demand. Gates replace calendar promises.

### Stage A: capped invitation pilot

Goal: independent groups complete sessions and voluntarily return. No real-money
checkout or unrestricted stranger discovery.

| ID | Priority | Work and acceptance condition |
| --- | --- | --- |
| A1 | P0 | Name the operator/support owner, pilot capacity and spending ceiling; confirm permission for intended commercial use of the host/domain |
| A2 | P0 | Establish asset rights and appropriate terms/privacy/rating notices before distribution; offer actionable recovery/data requests, initially manual if manageable |
| A3 | P0 | Share a usable room URL through login; let mobile users intentionally choose their game; provide a short first-table guide and reconnect/timeout expectations |
| A4 | P0 | Test representative data/load and restore complete off-host database/media backups into an isolated environment; set capacity caps and maintenance/rollback procedures |
| A5 | P0 | Define privacy-conscious events; measure invitation → join → first completed game → return, separating groups, bots and organic users |
| A6 | P1 | Test real iOS Safari/Android Chrome, rotation, background/foreground, weak networks, expired sessions, retries and complete sessions for focus games |

Suggested pilot: 5–10 independent groups over four weeks, a sampling plan rather than
a statistically validated demand threshold. Advance when several groups return
without operator prompting, serious defects are resolved, and hosts identify a
specific unmet need worth paying for. If sessions require constant manual rescue,
improve the core journey before promotion.

### Stage B: public free operation

Goal: safely admit strangers and measure repeat use. Automated matching is optional.

| ID | Priority | Work and acceptance condition |
| --- | --- | --- |
| B1 | P0 | Publish reviewed terms/privacy/community rules, rating/age information, operator details/support, consent versions and required notices |
| B2 | P0 | Complete report → triage → removal/sanction → appeal, protected operator access, session revocation and audit; cover chats, private messages, profiles, stickers and uploads |
| B3 | P0 | Establish recoverable identity and expiring single-use recovery; implement authenticated deletion/data-copy requests, retention exceptions and re-deletion after backup restores. Both LINE and Google login are not required |
| B4 | P0 | Filter spectator/eliminated-player snapshots server-side; verify private hands are absent from events, resume, exposed logs and replay. Until then, remain invitation-only; restricting spectator entry alone leaves eliminated-player leaks |
| B5 | P0 | Monitor external HTTPS/Socket flows, save failures/latency, event-loop delay, memory, disk/media growth, backup freshness and alert delivery; rehearse incident/restore workflows |
| B6 | P0 | Review uploads and voice defaults; disable unmanageable channels. Offered uploads need server-side decode/pixel/frame limits and review/removal; offered voice needs distinct-network testing and restricted/short-lived TURN credentials |
| B7 | P1 | Public product/game pages, help/announcements and tracked invitations; recruit clubs and hold regular sessions before buying broad traffic |
| B8 | P1 | Pilot room discovery with privacy/capacity/rule filters; disclose bots and waiting limits. Add matching only when concurrent demand supports it |
| B9 | P1 | Revisit whole-game abort after departure or missed 60-second reconnect; design game-specific substitution/forfeit and reward effects before changing this contract |
| B10 | P1 | Improve abuse defenses, dependency updates and enforced CSP after compatibility review; client resizing is not an upload security boundary |

Exit: reports/account requests work end to end; recipient privacy passes tests; off-host
restore and actionable alerts are demonstrated; measured peak load fits the caps.
Observe at least four weekly cohorts before attributing growth to retention. Do not
purchase broad traffic while completion and returning-group rates remain poor.

### Stage C: paid web pilot

Goal: validate a specific paid benefit and its contribution margin. Start with one
offer and one provider; manual sales also require legal, tax and delivery readiness.
A private-table paid pilot can follow Stage A once the applicable Stage B legal,
account, safety and operational gates pass; public discovery is not a prerequisite.

| ID | Priority | Work and acceptance condition |
| --- | --- | --- |
| C1 | P0 | Confirm business/tax/provider eligibility, prices, receipts/invoices, refunds and cancellation terms with appropriate advisers before production payment |
| C2 | P0 | Review billing persistence; migrate to transactional storage as needed, preserving Repository constraints, coins/ownership and a validated migration/rollback path |
| C3 | P0 | Server-priced orders, verified callbacks, unique external transaction IDs and atomic local order/right updates; tolerate duplicated, delayed and out-of-order events |
| C4 | P0 | Handle pending/failed/paid/refunded/disputed states, right revocation/downgrade, expiry/cancellation where applicable, auditable records and daily provider reconciliation |
| C5 | P0 | Test retries/crashes, paid-but-ungranted recovery, invalid callbacks, refunds/disputes and restore. External payment and local commit are separate: reconcile mismatches |
| C6 | P1 | Launch one original cosmetic pack or time-limited host plan; observe paid usage and renewals before large catalogs or automatic renewal |
| C7 | P1 | Define earning limits, receipts retention and abuse controls before coins unlock premium substitutes; evaluate bot farming, alternate accounts and forced completion |

Exit: sandbox cases and controlled production purchase/refund succeed; orders, rights
and provider statements reconcile; support resolves missing purchases; the cohort
contributes more than variable payment, content, delivery and servicing costs.
Positive contribution is not yet profit: include development and operator labor.

### Stage D: retention and selective growth

Select a direction supported by observed use; do not pursue all in parallel.

| ID | Direction | Value and prerequisites |
| --- | --- | --- |
| D1 | Persistent clubs, scheduled tables, host tools | Recurring-group subscription value; permissions, invitations and abuse controls |
| D2 | Tutorials, puzzles, practice and post-game review | Learning differentiation; accurate game-specific explanations and fair-information analysis |
| D3 | Ratings, seasons, free competitions | Competitive retention; standardized rules, separate bot/custom-rule records, abandonment/collusion controls and recipient privacy |
| D4 | Replay and delayed public spectating | Coaching/community; consent, private/public records, retention and safe timing of hidden-information release |
| D5 | Organization/club event packages | Potential higher-value sales; actual pilot buyer and bounded preparation, hosting, support and customization |
| D6 | Public matching | Sufficient players per game/time zone, queue limits, disclosed bot fallback and safety; avoid fragmented skill/mode queues |
| D7 | Mobile stores | Proven mobile experience and acquisition hypothesis; billing/privacy/moderation/review gates below |
| D8 | Horizontal scaling | Measured saturation/availability need; room ownership, routing, coordination and recovery design before adding processes |

## Monetization options and economics

| Model | Fit | Main limitation | Recommendation |
| --- | --- | --- | --- |
| Original cosmetic packs | Existing shop/inventory foundation | Free uploads/earned items are substitutes; most table/card styles are owner-only | Small transaction experiment; prioritize shared-visible frames/nameplates/stickers and preserve earned rights |
| Host/club plan | One paying organizer can bring a group | Needs recurring value: schedules, persistent clubs, shared themes, useful summaries | Strong initial hypothesis for returning groups; basic joining/gameplay remain free |
| Learning/review subscription | Potential committed learners | Rules help is not a curriculum; accuracy and analysis cost matter | Validate focus-game demand first; never provide an unfair active-game advantage |
| Organization events | Fewer customers may cover costs | Sales/setup/live support can dominate margin | Interview real buyers early; bounded service packages, not unlimited customization |
| Lobby advertising | Revenue from non-paying visitors | Unknown volume/fill/yield; consent, ad eligibility and policy work | Defer until measured traffic justifies it; never interrupt turns |
| Paid entry/transferable currency | Poor fit with fair social play | Legal, store and abuse exposure | Exclude from this roadmap |

Calculate economics per acquisition cohort and channel:

- Net monthly contribution = settled revenue minus refunds, payment/store fees,
  applicable tax allowance, variable infrastructure/TURN/media, content and support.
- Break-even payers = monthly fixed operating cost / monthly contribution per payer.
  Include unpaid development/support labor when evaluating actual business profit.
- Compare renewal/churn, lifetime contribution and acquisition cost; early samples do
  not support a reliable lifetime-value forecast. Use observed ad impressions/yield.

Illustration only: NT$10,000 fixed monthly costs and NT$125 monthly contribution per
payer imply 80 payers. At an assumed 2% monthly payer rate, that implies 4,000 monthly
active users. These are arithmetic inputs, not measured pricing, conversion, costs
or a forecast. Labor and channel fees can materially change the result.

## Development directions and trade-offs

Relative effort: S is bounded; M spans components; L adds substantial rules,
persistence or operations. These compare scope, not elapsed implementation time.

| ID | Direction | Effort | Order and constraint |
| --- | --- | --- | --- |
| E1 | Mobile selection, invitation sharing, first-game help, readable errors, easier practice entry | S–M | First; improves acquisition/completion. Evaluate beginner timer presets and limited account-free practice |
| E2 | Contrast, large/four-color cards, keyboard play, screen-reader announcements | M | Incremental; existing focus/ARIA/reduced-motion support is not accessibility certification |
| E3 | Bot difficulty/personality and independent practice progress | M | After onboarding evidence; only permitted information, disclose bots and separate practice from competitive records |
| E4 | Shared house-rule configuration and cleaner game adapters | M–L | Extend established shared/runtime boundaries for concrete modes; no blanket rewrite before demand |
| E5 | Hearts, Gong Zhu, Spades | M | Trick-taking concepts are reusable, not interchangeable Bridge rules; choose a requested title |
| E6 | Old Maid, Go Fish | M | Flexible-group onboarding; game-specific seating, rules, bots and UI still needed |
| E7 | Dou Dizhu, Run Fast | M–L | Regional appeal; three-seat layouts and distinct combinations/scoring |
| E8 | Tractor, duplicate Bridge | L | Multi-deck/joker or multi-table orchestration/scoring; established club demand first |
| E9 | Real-time slap-card games | L | Latency fairness, simultaneous arbitration and accessibility; high risk relative to turn-based strengths |
| E10 | Taiwanese sixteen-tile Mahjong | L | New pieces/art/rules/bots and market positioning; separate product investment |
| E11 | Daily challenges and replay-based review | M–L | Practice without concurrent players; separate challenge seeds from live randomness and protect active private hands |

Review rights before copying branded names, artwork or text. LLM coaching is optional:
evaluate accuracy, inference cost and private-data handling against deterministic
review first. Shuffle verification needs a threat model; do not reveal seeds before
all linked play ends or claim a commitment alone prevents manipulation/collusion.

## Operations after launch

| Cadence | Required work |
| --- | --- |
| Continuous/on-call | Service/security incidents, severe abuse and payment anomalies; define coverage/escalation before release |
| Daily | Off-host backup freshness, disk/media growth, failed writes, reports/support queue; payment reconciliation once charging |
| Weekly | Completion/abandonment, returning-group cohorts, queue times, spend/support hours, sanctions/appeals, earning abuse and dependencies |
| Monthly | Scheduled restore drills, access review, invoice/tax reconciliation, churn/margin/capacity and provider-policy review |
| Every release | Applicable checks, production-path build, schema/rollback review, maintenance notices and real end-to-end smoke checks |

Keep lasting runbooks in [deployment](deployment.md), [storage](storage.md), and
[media](media.md) as features ship. This roadmap does not certify those processes run.

| Metric | Definition/use |
| --- | --- |
| Acquisition | Landing → registration → join → first completed game, source tags and invited/organic separation |
| Core value | Active human groups, independent returns, completed sessions and invite acceptance; bot activity separate |
| Retention | D1/D7/D30 cohorts and weekly returning groups; show sample sizes and exclude unobservable windows |
| Match health | Start/wait time, completion, disconnect/abort/timeout rates, rule errors and latency p95 |
| Operations | Availability, write failures/duration, backup age, restore RPO/RTO, media/TURN traffic and response time |
| Business | Settled revenue, payer rate, contribution, renewal/churn, refunds/disputes, acquisition cost and operator hours |

Set service targets and capacity from measurements. Daily snapshots alone can lose
nearly 24 hours of writes; paid orders need stricter recovery/reconciliation. Set and
drill RPO/RTO based on player/billing impact. Health currently returns a fixed `ok`;
it does not establish database writability or successful player sessions.

Operational review must also address these concrete boundaries:

- Uploaded files have a public hash-addressed GET route and long-lived immutable
  caching. Owner-only presentation is not authenticated file confidentiality.
  Removal/deletion needs a served-file, cache, backup and reference-retention design.
- Each account can accumulate 100 MiB of images; replacement still counts and emoji
  deletion does not remove the file. Plan safe reference-aware cleanup, global limits
  and storage/backup/bandwidth cost; never delete files still referenced by messages.
- Host kicks are not durable service bans. Sanctions must prevent re-entry and handle
  sessions, rooms and alternate-account abuse without over-collecting personal data.
- Payment webhooks need independent provider verification and routing; do not disable
  the existing browser Origin guard globally to receive callbacks.
- Analytics/logs must exclude passwords/session tokens, private hands, private message
  contents and voice. Operational access and backups hold sensitive game/account data.

## Legal, licensing and mobile distribution

Review work, not legal advice or a classification. Official sources checked on
2026-10-14; recheck effective rules before release.

- **Taiwan ratings:** Article 6(6) addresses result-driven virtual currency; Article
  7(5) also covers card games without that relationship. No cash-out does not make
  a service all-ages. Review chips/coins, Liar's Deck imagery, chat/uploads and the
  combined release against the [Game Software Rating Regulations](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0030086).
- **Consumer obligations:** map actual fees, support, game records, termination and
  product-specific refunds to the [online-game contract requirements](https://law.moda.gov.tw/LawContent.aspx?id=GL000018).
  Do not assume every digital sale is non-refundable.
- **Personal data:** notice, access/copy/correction/deletion and justified retention
  need real procedures covering social records/media, backups and billing. The
  [Personal Data Protection Act](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021)
  marks some amendments as not yet effective; confirm the applicable version.
- **Gambling:** [Criminal Code Article 266](https://mojlaw.moj.gov.tw/LawContent.aspx?TypeSort=2&lawNumber=266&lsid=FL001424&media=print)
  includes internet gambling for property. Review monetization/competitions/value
  transfer with counsel; payment-provider acceptance is a separate requirement.
- **Licensing:** the application is already [MIT-licensed](../LICENSE); monetization
  does not require closing it. Card graphics have separate [LGPL notices](../client/src/assets/cards/README.txt).
  Audit distribution obligations, music/site emoji, generated/commissioned artwork,
  fonts, sounds and dependencies; preserve provenance and permissions. Owner-supplied
  or Git-ignored assets are not automatically commercially licensed.

Mobile release is a separate investment after demand/revenue evidence:

1. Choose supported platforms/regions and maintained packaging/native approach;
   verify touch, lifecycle, reconnect, audio/voice, performance and review access on
   real devices. A web wrapper alone does not establish sufficient app quality.
2. Prepare ratings, privacy/data-safety disclosures, permission explanations, support
   links and review accounts. Account-creating Apple apps need an in-app deletion
   path; Google Play also requires an external deletion resource.
3. Design receipt validation, store notifications, purchase restoration, refunds,
   subscription cancellation and cross-channel rights. Digital goods generally use
   store billing; regional programs/exceptions require specific review. Taiwan web
   checkout is not automatically a valid native checkout.
4. Complete UGC filtering, reporting, blocking and timely response. Review simulated-
   gambling presentation and advertising rules per channel; Google's real-money
   policy is not a blanket prohibition on all virtual card games.
5. Budget fees, review/maintenance and support; verify incremental acquisition or
   retention through a limited release before supporting multiple native platforms.

Sources: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Google Play payments](https://support.google.com/googleplay/android-developer/answer/9858738),
[Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111),
and [Google gambling/related ads](https://support.google.com/googleplay/android-developer/answer/9877032).

## Confirmed scope and remaining owner decisions

| Decision | Status or starting hypothesis | Impact |
| --- | --- | --- |
| First market | Confirmed: Taiwan first | Local legal, payment, invoicing and support readiness |
| Audience/focus games | Friend groups/clubs; select through pilot use | Onboarding, acquisition and paid offer |
| Distribution | Confirmed: web service first; evaluate PWA usefulness and stores after repeat-use/revenue evidence | Platform/billing/maintenance workload |
| Operator/resources | Named support owner, budget/capacity and spending cap | Realistic availability, moderation and pace |
| First paid offer | One original pack or host plan | Rights, billing and recurring content costs |
| Public Blackjack/Hold'em/Liar's Deck | Review ratings, provider and audience fit per channel | Release content, age controls and marketing |
| Free uploads/catalog | Preserve earned rights/uploads by default | Fair transition, differentiation and media costs |
| Advance/stop rules | Predefine return/completion/contribution/support-cost targets | Continue only when demand and economics justify investment |

Suggested order: A1–A5 → observed pilot → applicable B1–B6 safety/operations gates
→ C1–C6 paid validation or broader free beta → one validated Stage D direction.
OAuth, automatic matching, new games, large catalogs and native apps are not all
prerequisites for the first pilot.
