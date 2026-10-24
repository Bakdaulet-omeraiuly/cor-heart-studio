// Guideline / paper citations used in Evidence.source. Full references and the checking status of each threshold:
// docs/research/diagnosis-engine.md §2.
export const SRC = {
  ACC20: "ACC/AHA 2020 Valvular Heart Disease Guideline (Otto 2021, Circulation 143:e72–e227), doi:10.1161/CIR.0000000000000923",
  EACVI17: "EACVI/ASE 2017 aortic stenosis recommendations (Baumgartner, J Am Soc Echocardiogr 30:372–92), doi:10.1016/j.echo.2016.12.001",
  ASE15: "ASE/EACVI 2015 chamber quantification (Lang, J Am Soc Echocardiogr 28:1–39), doi:10.1016/j.echo.2014.10.003",
  ESC21: "ESC 2021 Heart Failure Guidelines (McDonagh, Eur Heart J 42:3599–726), doi:10.1093/eurheartj/ehab368",
  AHA22: "AHA/ACC/HFSA 2022 Heart Failure Guideline (Heidenreich, Circulation 145:e895–e1032), doi:10.1161/CIR.0000000000001063",
  UDHF21: "Universal Definition of Heart Failure 2021 (Bozkurt, J Card Fail 27:387–413), doi:10.1016/j.cardfail.2021.01.022",
  AHA17SEG: "AHA 17-segment model (Cerqueira 2002, Circulation 105:539–42), doi:10.1161/hc0402.102975",
  RUDSKI10: "ASE 2010 right heart guidelines (Rudski, J Am Soc Echocardiogr 23:685–713), doi:10.1016/j.echo.2010.05.010",
  CADRADS2: "CAD-RADS 2.0 (Cury 2022, JACC Cardiovasc Imaging 15:1974–2001), doi:10.1016/j.jcmg.2022.07.002",
  AHA09QT: "AHA/ACCF/HRS 2009 ECG standardization Part IV, QT interval (Rautaharju, J Am Coll Cardiol 53:982–91), doi:10.1016/j.jacc.2008.12.014",
  AHA09IVCD: "AHA/ACCF/HRS 2009 ECG standardization Part III, intraventricular conduction (Surawicz, J Am Coll Cardiol 53:976–81), doi:10.1016/j.jacc.2008.12.013",
  DREW10: "AHA/ACCF 2010 prevention of torsade de pointes in hospital settings (Drew, Circulation 121:1047–60), doi:10.1161/CIRCULATIONAHA.109.192704",
  BRADY18: "ACC/AHA/HRS 2018 bradycardia and conduction delay guideline (Kusumoto), doi:10.1016/j.jacc.2018.10.044",
  SVT15: "ACC/AHA/HRS 2015 SVT guideline (Page, J Am Coll Cardiol 67:e27–e115), doi:10.1016/j.jacc.2015.08.856",
  ESH23: "ESH 2023 hypertension guidelines (Mancia, J Hypertens 41:1874–2071), doi:10.1097/HJH.0000000000003480",
  ESC23CM: "ESC 2023 cardiomyopathy guidelines (Arbelo, Eur Heart J 44:3503–626), doi:10.1093/eurheartj/ehad194",
  BARNES09: "Barnes 2009 meta-analysis of hippocampal atrophy rates (Neurobiol Aging 30:1711–23), doi:10.1016/j.neurobiolaging.2008.01.010",
  DELEON89: "de Leon 1989 longitudinal CT ventricular change in AD (AJR 152:1257–62), doi:10.2214/ajr.152.6.1257",
  NIAAA18: "NIA-AA 2018 research framework for Alzheimer's disease (Jack, Alzheimers Dement 14:535–62), doi:10.1016/j.jalz.2018.02.018",
  MOSTELLER: "Body surface area, Mosteller formula (N Engl J Med 1987;317:1098), doi:10.1056/NEJM198710223171717",
} as const;
export type SourceKey = keyof typeof SRC;
