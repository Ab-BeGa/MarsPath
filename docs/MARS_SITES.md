# Каталог посадок NASA и подтверждённых научных событий на Марсе

**Состояние проверки источников: 14 ноября 2026 года.**

Машинный набор: [`public/data/mars-global/sites.json`](../public/data/mars-global/sites.json).  
Контракт/проверка: `web/marsSites.ts`, `web/marsSites.test.ts`.

Это **выборочный проверяемый каталог**, а не полный список миссий всех агентств. Он подготовлен для отдельного будущего слоя маркеров на глобальной карте. **В этой задаче новые маркеры в интерфейс не добавляются**. Для каждого пункта указаны миссия, тип, координаты, пояснение, первоисточник и ограничения точности.

## Схема координат и достоверность

- Числа хранятся как **градусы широты N+/S− и восточной долготы 0–360°**. Это координаты **Марса**; использовать земной WGS84 для геопривязки запрещено.
- `as_published` сохраняет оригинальную запись градусов из источника, включая нули справа, знак полушария и число знаков после запятой.
- `georeferencing.reported_decimal_places` — **точность записи**, а не измеренная погрешность. `estimated_horizontal_error_m: null` означает отсутствие надёжного численного значения в выбранных первоисточниках, а не нулевую погрешность.
- Для опубликованных координат **не везде явно указано определение широты** (planetocentric/planetographic), систему контроля и горизонтальную ошибку. Не использовать эти точки для субпиксельного совмещения с локальной CTX DEM без проверки исходного геодезического контракта и проекции.
- В каталоге для Spirit и Opportunity указан вариант **радиометрической Doppler-привязки** и сохранена независимая картографическая альтернатива NASA PDS ODE. Это демонстрирует, что две качественные опубликованные позиции одного посадочного аппарата могут не совпадать.
- **Научные события** с `anchor_site_id` отнесены к **местоположению стационарного прибора**. Координаты сейсмического эпицентра, отдельной траншеи или пробного материала этим не определяются. Совпадение точек на карте намеренное.

## Проверенные места посадки (9)

| Миссия и название | Тип | Дата UTC | Широта; долгота E | Регион | Источник координат / характер точности |
|---|---|---|---|---|---|
| Viking 1 | Посадочная станция | 1976-07-20 | 22.269° N; 312.049° E | Chryse Planitia | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), 3/3 десятичных знака; метры погрешности не указаны |
| Viking 2 | Посадочная станция | 1976-09-03 | 47.668° N; 134.280° E | Utopia Planitia | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), 3/3; метры погрешности не указаны |
| Mars Pathfinder / Sojourner | Станция и марсоход | 1997-07-04 | 19.095° N; 326.747° E | Ares Vallis | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), 3/3; **позиция станции**, не траектория Sojourner |
| Spirit | Марсоход | 2004-01-04 | 14.571892° S; 175.47848° E | Gusev Crater | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), радиометрия (6/5 знаков). Картографическая альтернатива: 14.5692° S; 175.4729° E |
| Opportunity | Марсоход | 2004-01-25 | 1.9483° S; 354.47417° E | Meridiani Planum | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), радиометрия (4/5). Картографическая альтернатива: 1.9462° S; 354.4734° E |
| Phoenix | Посадочная станция | 2008-05-25 | 68.22° N; 234.25° E | Vastitas Borealis | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), 2/2 знака; [NASA mission](https://science.nasa.gov/mission/mars-phoenix/) |
| Curiosity / Bradbury Landing | Марсоход | 2012-08-06 | 4.59° S; 137.44° E | Gale Crater | [NASA PDS ODE](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm), округлённый район посадки, 2/2 знака |
| InSight / Homestead Hollow | Посадочная станция | 2018-11-26 | 4.502° N; 135.623° E | Elysium Planitia | [Научная статья, размещённая в NASA NTRS](https://ntrs.nasa.gov/api/citations/20205003548/downloads/Warner_impact_origin_InSight_2020_2019JE006333_optimized.pdf), фактическое место посадки, 3/3 знака |
| Perseverance / Octavia E. Butler Landing | Марсоход | 2021-02-18 | 18.44463° N; 77.45088° E | Jezero Crater | [NASA NTRS, данные посадки/EDL](https://ntrs.nasa.gov/citations/20210024644), 5/5 знаков; **место посадки, не текущее положение марсохода** |

Описания миссий и контекст их посадок: [NASA — How We Land on Mars](https://science.nasa.gov/planetary-science/programs/mars-exploration/mission-timeline/how-we-land-on-mars/). Для Perseverance есть также [исследование геологии/визуализации из NASA NTRS](https://ntrs.nasa.gov/api/citations/20230016428/downloads/Bell%20et%20al%202022sciadv.pdf), в котором точка посадки округлена до 18.4446° N, 77.4509° E.

## Проверенные научные события (2)

| Событие | Тип | Дата UTC | Координата на карте | Миссия | Первичный источник и ограничения |
|---|---|---|---|---|---|
| Подтверждение водяного льда в образце грунта | Приборное исследование на поверхности | 2008-07-31 | **Точка аппарата Phoenix**, 68.22° N; 234.25° E | NASA Phoenix, TEGA | [NASA Phoenix Science Highlights](https://science.nasa.gov/mission/mars-phoenix/); координаты траншеи/конкретной пробы не установлены в каталоге |
| Первый **вероятный** марсотряс | Сейсмическое наблюдение | 2019-04-06 | **Точка InSight/SEIS**, 4.502° N; 135.623° E | NASA InSight, SEIS | [NASA, 23 апреля 2019](https://science.nasa.gov/missions/insight/nasas-insight-detects-first-likely-quake-on-mars/); **эпицентр не совпадает автоматически с расположением прибора** |

В обоих случаях `anchor_site_id` связывает наблюдение с посадочной станцией. Это географическая привязка **места получения измерения**, а не локализация физических событий с точностью до опубликованного количества цифр.

## Формат данных

Каждая запись в `sites.json` содержит `id`, `category`, `name`, `type`, `mission`, `region`, `date_utc`, `latitude_deg`, `longitude_east_deg`, `as_published`, `description_ru`, `georeferencing`, `sources`. У событий дополнительно присутствует `anchor_site_id`; у Spirit и Opportunity — `alternative_positions`.

Отображение на глобальной карте с диапазоном долготы −180…180° требует только перенормировки долготы для визуального центра (`longitude_east_deg > 180 ? longitude_east_deg - 360 : longitude_east_deg`). Это **не** преобразование марсианских координат в WGS84 и не проверка метрической точности.

## Проверка изменений

~~~powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
~~~

`web/marsSites.test.ts` проверяет: 9 посадок + 2 события, диапазоны марсианских координат, совпадение опубликованной записи с числами и количеством десятичных знаков, обязательные первоисточники, уникальность идентификаторов и сохранение событий на координатах их измерительных приборов.

**Граница готовности:** каталог можно использовать в планетном обзоре. Функция отображения маркеров/карточек в браузере в эту ветку не входит; её следует делать отдельно, чтобы не конфликтовать с действующим Mission Planner.
