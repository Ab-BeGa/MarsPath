/** Display translations only. Do not modify mission source metadata or georeferencing. */
import type { Locale } from './i18nCatalog.ts'
import type { MarsSite } from './marsSites.ts'

export const siteCopy = {
  "viking-1": {
    "en": [
      "Viking 1",
      "NASA's Viking 1 lander made the first successful US soft landing on Mars.",
      "The published coordinate identifies the landing site; no uncertainty in metres is given.",
      "First view of the Martian surface transmitted by Viking 1",
      "Viking 1 transmitted its first images from the surface shortly after landing in Chryse Planitia."
    ],
    "kk": [
      "Viking 1",
      "NASA Viking 1 аппараты Марсқа сәтті жұмсақ қонған алғашқы америкалық аппарат болды.",
      "Жарияланған координат қону орнын көрсетеді; метрмен өлшенетін қателік берілмеген.",
      "Viking 1 жіберген Марс бетінің алғашқы көрінісі",
      "Viking 1 Chryse Planitia жазығына қонғаннан кейін Марс бетінен алғашқы суреттерді жіберді."
    ]
  },
  "viking-2": {
    "en": [
      "Viking 2",
      "Viking 2 studied soil and atmosphere on Utopia Planitia.",
      "The published coordinates have three decimal places; the actual geodetic uncertainty is not documented here.",
      "Color view of the rocky terrain at the Viking 2 landing site",
      "The first Viking 2 color image shows the rocky Utopia Planitia surface."
    ],
    "kk": [
      "Viking 2",
      "Viking 2 Утопия жазығындағы топырақ пен атмосфераны зерттеді.",
      "Координат үш ондық таңбамен берілген, бірақ нақты геодезиялық қателік мұнда көрсетілмеген.",
      "Viking 2 қонған жердегі тасты беттің түсті суреті",
      "Viking 2 түсірген алғашқы түсті сурет Утопия жазығының тасты бетін көрсетеді."
    ]
  },
  "pathfinder": {
    "en": [
      "Mars Pathfinder / Sojourner",
      "The Pathfinder lander delivered the small Sojourner rover to Mars.",
      "These are lander coordinates; Sojourner's subsequent movements are not represented.",
      "Sojourner rover beside the Mars Pathfinder lander",
      "Mars Pathfinder delivered Sojourner, the first rover to operate on the Martian surface."
    ],
    "kk": [
      "Mars Pathfinder / Sojourner",
      "Pathfinder қону аппараты Марсқа шағын Sojourner марсоходын жеткізді.",
      "Бұл — қону аппаратының координаттары; Sojourner қозғалысының бағыты мұнда берілмеген.",
      "Mars Pathfinder жанындағы Sojourner марсоходы",
      "Mars Pathfinder Марс бетінде жұмыс істеген алғашқы Sojourner марсоходын жеткізді."
    ]
  },
  "spirit": {
    "en": [
      "Spirit",
      "Spirit landed inside Gusev Crater and subsequently explored the surrounding terrain.",
      "The same primary source lists a different cartographic solution; the methods disagree and no metre-level error is given.",
      "Spirit rover on the Martian surface",
      "Spirit explored rocks and soil in Gusev Crater from 2004 to 2010."
    ],
    "kk": [
      "Spirit",
      "Spirit марсоходы Гусев кратеріне қонып, айналасындағы жер бедерін зерттеді.",
      "Сол бастапқы дереккөзде басқа картографиялық шешім де бар; координаттар сәйкес келмейді, метрлік қателік берілмеген.",
      "Марс бетіндегі Spirit марсоходы",
      "Spirit 2004–2010 жылдары Гусев кратерінің жыныстары мен топырағын зерттеді."
    ]
  },
  "opportunity": {
    "en": [
      "Opportunity",
      "Opportunity landed in the Meridiani Planum region.",
      "Radiometric and map-based coordinates in one source differ slightly; uncertainty in metres is not specified.",
      "Opportunity rover on the surface of Mars",
      "Opportunity explored Meridiani Planum and found evidence of prolonged past exposure to liquid water."
    ],
    "kk": [
      "Opportunity",
      "Opportunity марсоходы Meridiani Planum аймағына қонды.",
      "Бір дереккөздегі радиометриялық және картографиялық координаттар сәл өзгеше; метрмен қателік көрсетілмеген.",
      "Марс бетіндегі Opportunity марсоходы",
      "Opportunity Meridiani Planum аймағын зерттеп, бұрын сұйық судың ұзақ уақыт әсер еткенін растады."
    ]
  },
  "phoenix": {
    "en": [
      "Phoenix",
      "A polar lander that studied soil and shallow subsurface water ice.",
      "Coordinates are rounded to hundredths of a degree and should not be interpreted as pixel-precise.",
      "Phoenix lander on the Martian arctic plain",
      "Phoenix investigated polar soil and confirmed water ice beneath the surface."
    ],
    "kk": [
      "Phoenix",
      "Полярлық аймақтағы топырақ пен жер бетіне жақын жатқан су мұзын зерттеген қону аппараты.",
      "Координаттар градустың жүздік үлесіне дейін дөңгелектелген, оларды пиксель дәлдігі деп түсіндіруге болмайды.",
      "Марстың арктикалық жазығындағы Phoenix қону аппараты",
      "Phoenix полярлық топырақты зерттеп, жер астында су мұзы бар екенін растады."
    ]
  },
  "curiosity": {
    "en": [
      "Curiosity / Bradbury Landing",
      "Curiosity landed in Gale Crater to study geology and conditions for past habitability.",
      "The catalog provides an approximate landing-area position, not the coordinates of every later rover stop.",
      "Curiosity rover self-portrait in Gale Crater",
      "Curiosity studies Gale Crater's geological history and whether it once provided habitable conditions for microbial life."
    ],
    "kk": [
      "Curiosity / Bradbury Landing",
      "Curiosity геология мен ежелгі тіршілікке қолайлы жағдайларды зерттеу үшін Гейл кратеріне қонды.",
      "Каталогта қону аймағының жуық координаты берілген; бұл ровердің кейінгі барлық аялдамаларының орны емес.",
      "Гейл кратеріндегі Curiosity марсоходының автопортреті",
      "Curiosity Гейл кратерінің геологиялық тарихын және бұрын микробтық тіршілікке қолайлы орта болған-болмағанын зерттейді."
    ]
  },
  "insight": {
    "en": [
      "InSight / Homestead Hollow",
      "The stationary InSight geophysical laboratory used a seismometer to investigate the interior of Mars.",
      "Actual landing coordinates are reported in the Homestead Hollow study; the consulted excerpt provides no metre-level error.",
      "InSight lander on the Martian surface",
      "InSight measured marsquakes and studied planetary rotation and internal structure."
    ],
    "kk": [
      "InSight / Homestead Hollow",
      "InSight стационарлық геофизикалық зертханасы сейсмометр арқылы Марстың ішкі құрылысын зерттеді.",
      "Нақты қону координаттары Homestead Hollow зерттеуінде берілген; қаралған үзіндіде метрлік қателік жоқ.",
      "Марс бетіндегі InSight қону аппараты",
      "InSight марс сілкіністерін өлшеп, ғаламшардың айналуы мен ішкі құрылысын зерттеді."
    ]
  },
  "perseverance": {
    "en": [
      "Perseverance / Octavia E. Butler Landing",
      "Perseverance landed in Jezero Crater to investigate ancient conditions and collect rock samples.",
      "Decimal precision reflects publication formatting, not a documented error bound in metres. This is the landing site, not the rover's current position.",
      "Perseverance rover on the floor of Jezero Crater",
      "Perseverance searches for signs of ancient microbial life and collects rock and regolith samples in Jezero."
    ],
    "kk": [
      "Perseverance / Octavia E. Butler Landing",
      "Perseverance ежелгі жағдайларды зерттеп, тау жыныстарының үлгілерін жинау үшін Езеро кратеріне қонды.",
      "Ондық таңбалар саны метрлік дәлдік шегін білдірмейді. Бұл — ровердің қазіргі орны емес, қону нүктесі.",
      "Езеро кратеріндегі Perseverance марсоходы",
      "Perseverance ежелгі микробтық тіршілік белгілерін іздеп, Езерода жыныс пен реголит үлгілерін жинайды."
    ]
  },
  "phoenix-water-ice": {
    "en": [
      "Phoenix: water ice confirmed",
      "NASA confirmed the presence of water ice after analyzing a Phoenix soil sample with the TEGA instrument.",
      "The marker shows Phoenix's published lander position, NOT the location of a specific trench or sample. This catalog does not establish the soil observation's exact coordinates.",
      "",
      ""
    ],
    "kk": [
      "Phoenix: су мұзының расталуы",
      "NASA Phoenix бортындағы TEGA құралымен топырақ үлгісін талдау арқылы су мұзының барын растады.",
      "Белгі нақты қазылған орынды немесе үлгі нүктесін ЕМЕС, Phoenix қону аппаратының жарияланған орнын көрсетеді. Нақты топырақ бақылауының координаты бұл каталогта анықталмайды.",
      "",
      ""
    ]
  },
  "insight-first-likely-marsquake": {
    "en": [
      "InSight: first likely marsquake",
      "On 6 April 2019 (Sol 128), the SEIS seismometer recorded the first probable marsquake signal; its origin was still under investigation.",
      "The point is the position of InSight's stationary seismometer, NOT the marsquake epicenter. This record does not establish the seismic source coordinates.",
      "",
      ""
    ],
    "kk": [
      "InSight: алғашқы ықтимал марс сілкінісі",
      "2019 жылғы 6 сәуірде (128-сол) SEIS сейсмометрі алғашқы ықтимал марс сілкінісінің сигналын тіркеді; оның шығу тегі сол кезде әлі зерттеліп жатқан.",
      "Нүкте сілкініс эпицентрін ЕМЕС, InSight стационарлық сейсмометрінің орнын көрсетеді. Бұл жазба сейсмикалық көздің координатын анықтамайды.",
      "",
      ""
    ]
  }
} as const

export type SiteField = 'name' | 'description' | 'notes' | 'imageAlt' | 'imageCaption'
const siteIndex: Record<SiteField, number> = {name:0, description:1, notes:2, imageAlt:3, imageCaption:4}
export function siteText(site: MarsSite, locale: Locale, field: SiteField): string {
  if (locale === 'ru') {
    return field === 'name' ? site.name : field === 'description' ? site.description_ru :
      field === 'notes' ? site.georeferencing.notes_ru :
      field === 'imageAlt' ? site.image?.alt_ru ?? '' : site.image?.caption_ru ?? ''
  }
  return siteCopy[site.id as keyof typeof siteCopy]?.[locale]?.[siteIndex[field]] ??
    (field === 'name' ? site.name : '—')
}
