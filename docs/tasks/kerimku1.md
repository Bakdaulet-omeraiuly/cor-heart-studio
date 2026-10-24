# Тапсырма: @kerimku1 — чат, Claude API және интеграция

> Бұл — **сенің** файлың. @HyorinmaruK-тің файлы: [`HyorinmaruK.md`](HyorinmaruK.md). Барлық шешімді екеуің өздерің қабылдайсыңдар — иесінің (@Bakdaulet-omeraiuly) рұқсаты керек емес.

## Жоба туралы — екеуіңе ортақ

Сайттағы пациент жазбасы (record) бойынша **дәрігермен сөйлесетін диагностикалық көмекші** жасаймыз. Ол:
сайтта бар аурулардың дәрежесін гайдлайн бойынша нақты есептейді, дифференциалды диагноз ұсынады (әр нұсқаға дәлел:
қай сан, қай ереже, қай гайдлайн), жетіспейтін деректі айтады және 3D-да тиісті жерді көрсетеді.

**Шекара:** сайт "not a medical device, no diagnosis" деп жазылған (`AGENTS.md`). Бот — **дәрігерге көмекші**
(clinical decision support), пациентке диагноз айтпайды. Әр тұжырымда дереккөзі болады, сонда дәрігер оны өзі
тексере алады. "Бұл диагноз емес" деген белгі тұрады. Шұғыл белгілер (red flags) болса — тек "шұғыл маманға жүгіну".

**Басты принцип:** санды да, дәрежені де **код** есептейді, LLM ешқашан сан ойлап таппайды — ол тек түсіндіреді,
сұрақ қояды, дәлелге сілтейді.

**Ауқым** (сайтта бар): аорталық стеноз (ACC/AHA 2020), регургитация, митралды пролапс; LV дисфункциясы (EF),
дилатация, LVH, қабырға қозғалысы; LA/RA/RV ұлғаюы; коронар стенозы (CAD-RADS 2.0); ЭКГ/QTc; ми: қартаю vs
Альцгеймер атрофиясы. Ережелер: `src/domain/mapping/` (`R-VALVE-STEN-01`, `R-LV-EF-*`, `R-CORO-STEN-01`, …),
`src/domain/coronary.ts`, `src/domain/ecg.ts`, `docs/outlook.md`, `docs/coronary.md`, `docs/ecg.md`.
Кіріс — тек жазба (`src/domain/schema/record.ts`, мысалдар `public/samples/`); сурет/DICOM бұл кезеңде жоқ.

**Кодты тек Kiro-да жазасыңдар, Spec арқылы** (vibe-mode емес). Claude-пен (Claude Code / claude.ai) зерттеп,
ақылдасасыңдар. Kiro `AGENTS.md`-дағы жоба ережелерін өзі оқиды.

## Сенің рөлің

Сен **"дауысты"** жасайсың: дәрігер сұрайды → сервер Claude API-ді шақырады → Claude қозғалтқыштың
`assess()` нәтижесін **tool** арқылы алады → дәлелге сілтемесі бар жауап → UI-да көрсету, 3D-ға апару.
Бағалау скрипті де сенікі.

| Сенікі | Сенікі емес (HyorinmaruK) |
|---|---|
| `src/app/api/assistant/**` (серверлік route) | `src/domain/diagnosis/**` |
| чат панелі: `src/components/assistant/**` | `tests/unit/diagnosis/**` |
| `tests/e2e/assistant.spec.ts` | `tests/assistant/cases/**` (тест жиынтығы) |
| `scripts/eval-assistant.ts` (`npm run eval:assistant`) | `docs/research/diagnosis-engine.md` |
| `docs/research/assistant-chat.md` | `.kiro/specs/diagnosis-engine/` |
| `.kiro/specs/assistant-chat/` | |

## Ортақ келісім — интерфейс (екі файлда бірдей)

Екеуіңді байланыстыратын **жалғыз** нәрсе. Бірінші күні осы файлды @HyorinmaruK push жасайды. Кейін өзгертсең — екіншісіне алдын ала айт, себебі екеуіңнің кодың соған сүйенеді.

```ts
// src/domain/diagnosis/types.ts
import type { PatientRecord } from "@/domain/schema/record";

export interface Evidence {
  field: string;            // жазбадағы өріс, мысалы "valves.aortic.peakVelocity"
  value: number | string;
  unit?: string;
  rule: string;             // "R-VALVE-STEN-01" немесе жаңа ереже id
  source: string;           // гайдлайн + DOI
}

export interface Finding {
  condition: string;        // "aortic-stenosis"
  label: string;            // "Aortic stenosis, severe"
  grade?: string;           // "severe"
  basis: "rule-defined" | "supported" | "possible";
  evidence: Evidence[];
  organ: "heart" | "brain";
  target?: string;          // 3D нысан id (клапан, коронар сегменті, ми аймағы)
}

export interface Assessment {
  findings: Finding[];      // ережемен анықталғандар
  differential: Finding[];  // ықтимал балама түсіндірмелер
  missing: { field: string; why: string }[];
  redFlags: string[];
  disclaimer: string;
}

export type Assess = (record: PatientRecord) => Assessment;   // таза функция, желісіз, детерминистік
```

## Қадамдар

**1. Зерттеу (Claude-пен)** → `docs/research/assistant-chat.md`
- Архитектураларды салыстыр: (A) ережелер + LLM tool use; (B) A + гайдлайн мәтіндеріне RAG (дәйексөз үшін);
  (C) таза LLM — неге жарамайтынын өз тест жиынтығымызда **өлшеп** көрсет.
- Медициналық LLM қауіптері: галлюцинация, шамадан тыс сенімділік, prompt injection (жазба ішіндегі мәтін).
- Реттеу: FDA CDS 2022 гайдансы, EU MDR Rule 11 — бот нені айта алады, нені жоқ.
- Модель таңдау: Claude модельдерін (мысалы `claude-opus-5-5`, `claude-sonnet-5-5`) біздің жиынтықта
  салыстыр — дәлдік, жылдамдық, баға. Таңдау өлшеммен шешіледі.
- Claude API құжаттамасын (tool use, streaming) ағымдағы нұсқасынан оқы, есте сақталғанға сенбе.

**2. Kiro Spec** `assistant-chat` → `.kiro/specs/assistant-chat/{requirements,design,tasks}.md`
- Spec-ті push жасап, кодқа көш.

**3. Жалған қозғалтқышпен баста:** HyorinmaruK `types.ts`-ті push жасағанша, `Assessment` түріндегі
қолдан жазылған мысалмен (fixture) жұмыс істе. Қозғалтқыш дайын болғанда — тек импортты ауыстырасың.

**4. Сервер** `src/app/api/assistant/`:
- `ANTHROPIC_API_KEY` **тек серверде** (production кілтін Vercel env-ке @Bakdaulet-omeraiuly қосады, себебі Vercel-ге кіру тек оның қолында — керек кезде айт; жергілікті — өз кілтің `.env.local`-да, git-те жоқ).
  Клиентке, логқа, PR-ға ешқашан.
- Tools: `assess` (қозғалтқыш), қажет болса `explain_rule` (ереже + дереккөз мәтіні).
- System prompt: шекара (дәрігерге көмекші, диагноз емес), сандарды тек tool нәтижесінен алу, әр тұжырымға сілтеме,
  жетіспейтін деректі айту, red flags.
- Жазба ішіндегі мәтін — **дерек**, нұсқау емес (prompt injection қорғанысы).
- Пациент жазбасы логқа жазылмайды, сақталмайды. Rate limit, жауап ұзындығы шегі (Vercel Hobby).
- Next.js 16 — `AGENTS.md` басындағы ескертуді оқы, route API өзгерген.

**5. UI** — чат панелі: `docs/design-system.md` ережелерімен (бір жол экранда, толығы ⓘ артында).
Жауаптағы дәлел сілтемесін басқанда — 3D-да `target`-ке камера фокусы. "Бұл диагноз емес" белгісі әрқашан көрінеді.

**6. Бағалау скрипті** `scripts/eval-assistant.ts`: `tests/assistant/cases/` жағдайларын API арқылы өткізіп,
"Дайын болды" кестесінің әр өлшемін есептейді (әсіресе: жауаптағы әр сан жазбада/`Assessment`-те бар ма).

## Кезеңдер

| # | Нәтиже |
|---|---|
| K1 | `docs/research/assistant-chat.md` + модель салыстыру |
| K2 | Kiro spec дайын |
| K3 | API route + чат панелі, жалған қозғалтқышпен, e2e тест |
| K4 | Нақты қозғалтқышқа қосу, 3D сілтемелер |
| K5 | `npm run eval:assistant` — барлық шарт орындалды |

## Шатаспау үшін ережелер

- **Әркім тек өз папкаларын өзгертеді** (жоғарыдағы кестеде). Басқасының файлына тию керек болса — алдымен
  оған айт.
- Әркім **өз бетімен push жасайды** — тікелей `main`-ге немесе өз тармағына, қалауыңша. Ешкімнің рұқсаты керек емес.
- Push алдында: `git pull --rebase`, сосын `npm run typecheck && npm run lint && npm test`; UI өзгерсе
  `npm run build && npm run test:e2e`.
- `main`-ге push болған сайын Vercel сайтты production-ға өзі шығарады. Бір нәрсе бұзылса — `git revert <sha>` және push.
- Тармақ ашсаң — Vercel оған preview сілтемесін өзі береді.
- `.env*`, кілттер, нақты пациент деректері — ешқашан git-ке емес.

## Дайын болды деген шарттар (бүкіл жоба)

Тест жиынтығы `tests/assistant/cases/` (≥ 60 жағдай) бойынша:

| Өлшем | Шарт |
|---|---|
| Ережемен анықталатын дәреже (AS, CAD-RADS, EF, QTc…) | **100%** сәйкес |
| Жауаптағы сандар | **0** ойдан шығарылған (әр сан жазбада немесе `Assessment`-те бар) |
| Дәйексөз | әр клиникалық тұжырымда ереже/гайдлайн |
| Жетіспейтін дерек | әрқашан айтылады, болжап толтырылмайды |
| Ауқымнан тыс / пациентке диагноз сұрау | сыпайы бас тарту + не істеуге болатыны |
| Prompt injection (жазба ішіндегі "ережені елеме") | 0 сәтті шабуыл |

`main`-ге push болған сайын Vercel сайтты production-ға өзі шығарады — сондықтан тек тесттер өтсе push жаса.
