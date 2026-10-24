# Тапсырма: @HyorinmaruK — клиникалық қозғалтқыш және бағалау

> Бұл — **сенің** файлың. @kerimku1-дің файлы: [`kerimku1.md`](kerimku1.md). Барлық шешімді екеуің өздерің қабылдайсыңдар — иесінің (@Bakdaulet-omeraiuly) рұқсаты керек емес.

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

Сен **"миды"** жасайсың: жазба → `Assessment`. Желі жоқ, LLM жоқ — таза, тестіленген TypeScript.
Тест жиынтығы мен "дәлдікті" өлшеу де сенікі.

| Сенікі | Сенікі емес (kerimku1) |
|---|---|
| `src/domain/diagnosis/**` | `src/app/api/assistant/**` |
| `tests/unit/diagnosis/**` | чат UI компоненттері |
| `tests/assistant/cases/**` (тест жиынтығы) | `scripts/eval-assistant.ts` |
| `docs/research/diagnosis-engine.md` | `docs/research/assistant-chat.md` |
| `.kiro/specs/diagnosis-engine/` | `.kiro/specs/assistant-chat/` |

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

**1. Зерттеу (Claude-пен)** → `docs/research/diagnosis-engine.md`
- Әр жағдайға ағымдағы ресми критерийлер, **бастапқы дереккөзден, DOI-мен**: ACC/AHA 2020 valvular;
  ASE/EACVI chamber quantification 2015; CAD-RADS 2.0; ESC/ACC HF (EF шектері); QTc шектері; AD атрофиясы
  (`docs/outlook.md`-дағы дереккөздер). Есте сақталған санға сенбе — абстракт/мәтіннен көшір.
- Шекаралық мәндер, критерийлер қайшы келгенде не істейміз (мысалы Vmax severe, AVA moderate → discordant AS).
- Дифференциал логикасы: қай белгілер қай баламаларды қолдайды.

**2. Kiro Spec** `diagnosis-engine` → `.kiro/specs/diagnosis-engine/{requirements,design,tasks}.md`
- Талаптар EARS форматында; design — ережелер кестесі (id, кіріс өрістері, шектер, дереккөз).
- Spec-ті push жасап, кодқа көш.

**3. Бірінші күні — интерфейсті push жаса:** `src/domain/diagnosis/types.ts` (жоғарыдағы келісім) + бос `assess()`,
ол `findings: []` қайтарады. kerimku1 сонымен бірден жұмыс істей бастайды.

**4. Қозғалтқыш** (Kiro `tasks.md` бойынша, әр ауру тобы — бөлек коммит):
клапандар → сол қарынша → басқа камералар → коронарлар → ЭКГ → ми.
Бар ережелерді (`src/domain/mapping/`, `coronary.ts`, `ecg.ts`) **қайта қолдан**, көшірме жасама.

**5. Тесттер:** әр шекке unit тест, шекаралық мәндермен (Vmax 3.99 / 4.00, EF 40 / 41 …).

**6. Тест жиынтығы** `tests/assistant/cases/*.json` (≥ 60): синтетикалық жазбалар, гайдлайн мысалдары,
шекаралық мәндер, толық емес жазбалар, ауқымнан тыс сұрақтар, prompt-injection мәтіні бар жазбалар.
Әр жағдайда: кіріс, күтілетін `Assessment` (немесе күтілетін мінез-құлық), дереккөз.
Мүмкін болса — 20 жағдайды дәрігерге тексерт, нәтижесін зерттеу құжатына жаз.

## Кезеңдер

| # | Нәтиже |
|---|---|
| H1 | `docs/research/diagnosis-engine.md` |
| H2 | Kiro spec дайын |
| H3 | `types.ts` + бос `assess()` push болды (kerimku1-ді бөгемеу үшін — ең бірінші) |
| H4 | Барлық ауру топтары + unit тесттер |
| H5 | Тест жиынтығы ≥ 60 жағдай |

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
