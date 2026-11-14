/** Presentation-only localization for errors from scientific parsers.
 * Do NOT translate the underlying error text or change tests / validation rules.
 */
import { catalog, translate, type Locale } from './i18nCatalog.ts'

/** [English, Қазақша] — original Russian remains authoritative in algorithm tests. */
const errors: Record<string, readonly [string, string]> = {
  'Некорректные пороги': ['Invalid thresholds', 'Еңіс шектері жарамсыз'],
  'Браузер не поддерживает Canvas 2D': ['Browser does not support Canvas 2D', 'Браузер Canvas 2D технологиясын қолдамайды'],
  'Некорректный формат экспорта маршрута': ['Invalid route export format', 'Бағыт экспортының пішімі жарамсыз'],
  'Некорректный формат числа в экспорте маршрута': ['Invalid number in route export', 'Бағыт экспортындағы сан жарамсыз'],
  'Некорректный формат метрики маршрута': ['Invalid route metric', 'Бағыт көрсеткіші жарамсыз'],
  'Некорректный SHA-256 источника DEM': ['Invalid DEM source SHA-256', 'DEM дереккөзінің SHA-256 мәні жарамсыз'],
  'Некорректный формат параметров маршрута': ['Invalid route parameters', 'Бағыт параметрлері жарамсыз'],
  'Некорректный формат интервала маршрута': ['Invalid route interval', 'Бағыт аралығы жарамсыз'],
  'Длины интервалов не совпадают с длиной маршрута': ['Interval lengths do not match total route length', 'Аралықтар ұзындығы жалпы бағыт ұзындығына сәйкес емес'],
  'Прямой маршрут должен содержать две контрольные точки': ['Direct route must have two waypoints', 'Тікелей бағытта екі бақылау нүктесі болуы тиіс'],
  'Проекции маршрутов различаются': ['Route projections do not match', 'Бағыттардың проекциялары сәйкес емес'],
  'Маршруты рассчитаны по разным DEM. Повторите экспорт с одним исходным GeoTIFF.': ['Routes were computed from different DEM sources. Re-export using the same GeoTIFF.', 'Бағыттар әртүрлі DEM бойынша есептелген. Бір GeoTIFF арқылы қайта экспорттаңыз.'],
  'Начальная и конечная точки маршрутов должны совпадать': ['Routes must share start and destination', 'Бағыттардың бастапқы және соңғы нүктелері бірдей болуы тиіс'],
  'Значения шага выборки различаются': ['Route sample intervals do not match', 'Бағыттың өлшеу қадамдары сәйкес емес'],
  'Пороги уклонов различаются': ['Route grade thresholds do not match', 'Бағыттардың еңіс шектері сәйкес емес'],
  'Неподдерживаемая марсианская DEM-привязка маршрута': ['Unsupported Mars DEM route transform', 'Марс DEM бағытының түрлендіруі қолдау таппайды'],
  'Маршрут должен содержать минимум две действительные XY-точки': ['Route requires at least two valid XY points', 'Бағыт үшін кемінде екі жарамды XY нүктесі қажет'],
  'Для профиля нужны минимум две точки в метрической проекции Марса': ['Profile needs at least two Mars-projected metric points', 'Профильге Марстың метрлік проекциясында кемінде екі нүкте қажет'],
  'Шаг измерений профиля должен быть положительным': ['Profile sample step must be positive', 'Профиль өлшеу қадамы оң болуы тиіс'],
  'Несогласованные высота и статус DEM': ['DEM elevation and validity status are inconsistent', 'DEM биіктігі мен жарамдылық күйі сәйкес емес'],
  'Соседние контрольные точки должны различаться': ['Consecutive waypoints must differ', 'Қатар тұрған бақылау нүктелері әртүрлі болуы керек'],
  'Слишком много измерений для интерактивного профиля': ['Too many samples for the interactive profile', 'Интерактивті профиль үшін өлшемдер тым көп'],
  'Не удалось выбрать точку профиля': ['Could not select profile point', 'Профиль нүктесін таңдау мүмкін болмады'],
  'Выбранная точка отсутствует в профиле': ['Selected point is not in the profile', 'Таңдалған нүкте профильде жоқ'],
  'Для карты требуется исходная марсианская проекция Jezero, не WGS84': ['Map requires the source Mars Jezero projection, not WGS84', 'Картаға WGS84 емес, Езероның бастапқы Марс проекциясы қажет'],
  'Недопустимые размеры карты DEM': ['Invalid DEM map dimensions', 'DEM картасының өлшемдері жарамсыз'],
  'Неподдерживаемая привязка DEM: требуется северо-ориентированная сетка': ['Unsupported DEM georeferencing: north-up grid required', 'DEM географиялық байланысы қолдау таппайды: солтүстікке бағытталған тор қажет'],
  'Некорректный радиус Марса': ['Invalid Mars radius', 'Марс радиусы жарамсыз'],
  'Не указаны контрольные точки Jezero': ['Jezero reference points are missing', 'Езеро бақылау нүктелері көрсетілмеген'],
  'На карте отсутствует база или научная точка': ['Base or science stop is missing from the map', 'Картада база немесе ғылыми нүкте жоқ'],
  'Размеры двоичных DEM не соответствуют metadata.json': ['Binary DEM sizes do not match metadata.json', 'Бинарлық DEM өлшемдері metadata.json файлына сәйкес емес'],
  'Некорректное значение маски DEM': ['Invalid DEM mask value', 'DEM маскасының мәні жарамсыз'],
  'Некорректная высота действительного пикселя DEM': ['Invalid elevation in a valid DEM pixel', 'DEM-нің жарамды пикселіндегі биіктік мәні жарамсыз'],
  'Нет действительных высот DEM': ['No valid DEM elevations', 'DEM-де жарамды биіктіктер жоқ'],
  'Не удалось загрузить бинарные высоты или маску DEM': ['Could not load binary DEM elevations or mask', 'Бинарлық DEM биіктіктерін немесе маскасын жүктеу мүмкін болмады'],
  'Неподдерживаемый оптический слой CTX': ['Unsupported CTX optical layer', 'CTX оптикалық қабаты қолдау таппайды'],
  'Оптический слой относится к другому участку Марса': ['Optical layer belongs to another Mars region', 'Оптикалық қабат Марстың басқа аймағына тиесілі'],
  'Оптический слой построен для другой модели высот или другой проекции Марса': ['Optical layer uses a different DEM or Mars projection', 'Оптикалық қабат басқа DEM немесе Марс проекциясы бойынша жасалған'],
  'Отсутствует действительный SHA-256 источника/изображения CTX': ['Missing valid CTX source/image SHA-256', 'CTX дереккөзінің/кескінінің жарамды SHA-256 мәні жоқ'],
  'Источник CTX не является официальным ортофотопланом USGS': ['CTX source is not the official USGS orthomosaic', 'CTX дереккөзі ресми USGS ортофотожоспары емес'],
  'Неожиданный файл оптического слоя или отсутствует NoData-маска': ['Unexpected optical file or missing NoData mask', 'Оптикалық файл күтілмеген немесе NoData маскасы жоқ'],
  'Недопустимый размер CTX': ['Invalid CTX dimensions', 'CTX өлшемдері жарамсыз'],
  'Слишком много недействительных пикселей CTX': ['Too many invalid CTX pixels', 'CTX-де жарамсыз пикселдер тым көп'],
  'Оптический PNG CTX отсутствует или повреждён': ['CTX optical PNG is missing or corrupt', 'CTX оптикалық PNG файлы жоқ немесе бүлінген'],
  'Размер оптического PNG не совпадает с марсианской геопривязкой': ['Optical PNG dimensions disagree with Mars georeferencing', 'Оптикалық PNG өлшемдері Марстың географиялық байланысына сәйкес емес'],
  'Пороги должны удовлетворять: 0 < пологий < умеренный < крутой < 90°': ['Thresholds must satisfy 0 < gentle < moderate < steep < 90°', 'Шектер 0 < жайпақ < орташа < тік < 90° шартын қанағаттандыруы керек'],
  'Недопустимое значение измеренного продольного уклона': ['Invalid measured longitudinal grade', 'Өлшенген бойлық еңіс жарамсыз'],
  'Необходимо минимум две корректные точки в марсианской проекции': ['At least two valid Mars-projected points are required', 'Марс проекциясында кемінде екі жарамды нүкте қажет'],
  'Шаг измерений должен быть от 0 до 20 м (включительно)': ['Sampling step must be in (0, 20] m', 'Өлшеу қадамы (0, 20] м аралығында болуы керек'],
  'Соседние точки маршрута должны отличаться': ['Consecutive route points must differ', 'Бағыттың қатар тұрған нүктелері әртүрлі болуы тиіс'],
  'Слишком много отсчётов вдоль маршрута': ['Too many route samples', 'Бағыттағы өлшемдер тым көп'],
  'Расстояния DEM-отсчётов должны возрастать': ['DEM sample distances must increase', 'DEM өлшемдерінің қашықтығы өсуі керек'],
  'Некорректные координаты маршрутов': ['Invalid route coordinates', 'Бағыт координаттары жарамсыз'],
  'Для отображения нужны два маршрута с началом и концом': ['Two routes with start and destination are required', 'Басы мен соңы бар екі бағыт қажет'],
  'Начало и конец маршрутов должны совпадать': ['Route endpoints must match', 'Бағыттардың басталуы мен аяқталуы сәйкес болуы тиіс'],
}

const prefixes: readonly [string, string, string][] = [
  ['Неверные метаданные DEM:', 'Invalid DEM metadata:', 'DEM метадеректері жарамсыз:'],
  ['Неверное число DEM:', 'Invalid DEM number:', 'DEM саны жарамсыз:'],
  ['Отсутствует поле DEM:', 'Missing DEM field:', 'DEM өрісі жоқ:'],
  ['Неверный формат DEM:', 'Invalid DEM format:', 'DEM пішімі жарамсыз:'],
  ['Недопустимое имя файла DEM:', 'Invalid DEM file name:', 'DEM файл атауы жарамсыз:'],
  ['Не удалось загрузить metadata.json (HTTP ', 'Could not load metadata.json (HTTP ', 'metadata.json жүктелмеді (HTTP '],
  ['Некорректные метаданные CTX:', 'Invalid CTX metadata:', 'CTX метадеректері жарамсыз:'],
  ['Некорректное число CTX:', 'Invalid CTX number:', 'CTX саны жарамсыз:'],
  ['Отсутствует поле CTX:', 'Missing CTX field:', 'CTX өрісі жоқ:'],
  ['Некорректная геопривязка CTX:', 'Invalid CTX georeferencing:', 'CTX географиялық байланысы жарамсыз:'],
  ['CTX и DEM не совпадают по ', 'CTX and DEM differ in ', 'CTX пен DEM сәйкес келмейді: '],
  ['Не удалось получить метаданные CTX (HTTP ', 'Could not load CTX metadata (HTTP ', 'CTX метадеректері жүктелмеді (HTTP '],
]

export function localizeErrorMessage(message: string, locale: Locale): string {
  if (locale === 'ru') return message
  // Scientific validator errors must not be changed, only their UI rendering.
  for (const [, entries] of Object.entries(catalog)) {
    if (entries[0] === message) return entries[locale === 'en' ? 1 : 2]
  }
  const match = /^Не удалось прочитать JSON из файла «(.+)»\.$/.exec(message)
  if (match) return translate('error.readFile', locale, {file:match[1]})
  const exact = errors[message]
  if (exact) return exact[locale === 'en' ? 0 : 1]
  for (const [ru, en, kk] of prefixes) {
    if (message.startsWith(ru)) return (locale === 'en' ? en : kk) + message.slice(ru.length)
  }
  return translate('error.generic', locale)
}

export const localizedValidatorErrors = errors
