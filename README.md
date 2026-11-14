# MarsPath — данные рельефа Езеро

Текущий этап — подготовка рельефа Езеро и проверка марсианских координат перед подключением данных к веб-планировщику. Это пока не оценка безопасности маршрута.

Python здесь используется для разовой подготовки и проверки файлов рельефа на компьютере. Это не сервер и не backend приложения: будущий интерфейс на React/TypeScript сможет читать компактные файлы из `public/data/jezero/`.

## Что подготовлено

- Исходный USGS Mars 2020 Science Investigation CTX DEM Mosaic, 20 м/пиксель.
- Скрипт [`scripts/preprocess_dem.py`](scripts/preprocess_dem.py), который проверяет растр, координаты проектных точек и экспортирует локальный участок 1,5 × 1,5 км.
- Компактный набор для браузера: `heights.f32`, `mask.u8`, `metadata.json` и контрольные суммы в `public/data/jezero/`.
- Координаты базы и научной остановки выведены на карту: [`docs/jezero_site_points.png`](docs/jezero_site_points.png).
- Проверки координат, пикселей и расстояния описаны в [`docs/COORDINATE_VALIDATION.md`](docs/COORDINATE_VALIDATION.md); сведения о выбранных точках — в [`docs/SITE_SELECTION.md`](docs/SITE_SELECTION.md).

Исходный GeoTIFF исключён из Git через `.gitignore`; скачивайте его на локальный компьютер. В `sources/` проектного зеркала ничего не сохраняйте и не меняйте.

## Повторить подготовку

Требуется Python и зависимости из [`requirements.txt`](requirements.txt). В PowerShell из корня репозитория:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
New-Item -ItemType Directory -Force data | Out-Null
Invoke-WebRequest `
  -Uri "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.xml" `
  -OutFile "data/M20_JezeroCrater_CTXDEM_20m.xml"
.\.venv\Scripts\python.exe scripts\preprocess_dem.py --download
```

`--download` скачает исходный GeoTIFF, если его нет. Точки берутся из [`points/jezero_points.csv`](points/jezero_points.csv). Результат содержит 75 × 75 ячеек при исходном шаге 20 м, отдельную маску пропусков, CRS, границы, NoData, высоты точек и SHA-256. Скрипт остановится с ошибкой, если CRS, шаг сетки, NoData или покрытие точек не соответствуют ожиданиям.

## Ограничения

- DEM описывает рельеф на масштабе своей сетки и не обнаруживает отдельные небольшие камни.
- Модельное время движения и любые пороги проходимости должны быть добавлены отдельно и обозначены как допущения команды.
- Этот продукт не сертифицирует EVA и не гарантирует безопасность.
- Точки базы и научной остановки заданы таблицей задач; названия точек не проверены этим DEM-скриптом.

Источник и подробная запись — [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Данные для веб-планировщика

Чтобы получить компактную локальную сетку `public/data/jezero/` (массивы высот Float32, отдельная NoData-маска, JSON-метаданные и контрольные суммы), из корня репозитория выполните:

```powershell
python -m pip install -r requirements.txt
python scripts/preprocess_dem.py --download
python -m unittest discover -s tests -v
```

`data/M20_JezeroCrater_CTXDEM_20m.tif` — скачанный исходный GeoTIFF (не хранится в Git). `public/data/jezero/heights.f32` и `mask.u8` — компактные файлы для чтения сетки в браузере. Сетка сохраняет исходный шаг 20 м и марсианскую проекцию; координаты не переводятся в земную WGS84.

## Интерактивные маршруты с поворотами

Объединённый модуль: `profile_mars.py` показывает реальный участок NASA/USGS DEM, позволяет добавлять и перетаскивать промежуточные точки, строит профиль высот и экспортирует маршрут. Две конечные точки (условная база и научная остановка) фиксированы. Код геометрии вынесен в `route_geometry.py`, тесты — в `tests/test_route_geometry.py`.

**Используется тот же исходный DEM, что и в пайплайне подготовки:** `data/M20_JezeroCrater_CTXDEM_20m.tif` (скачивается отдельно, в Git не хранится). Если файл лежит в `jezero_site_selection/`, программа тоже найдёт его.

Из корня репозитория:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe profile_mars.py
```

Управление: клик ЛКМ — добавить промежуточную точку в ближайший сегмент; перетаскивание ЛКМ — переместить; ПКМ — удалить; `Ctrl+Z` — отмена; `R` — сброс; `E` — экспорт. Файлы `route_profile.csv`, `route_waypoints.json`, `route_profile.png` сохраняются в корне проекта и исключены из Git.

Повторно загрузить сохранённый маршрут:

```powershell
.\.venv\Scripts\python.exe profile_mars.py --load route_waypoints.json
```

Проверить модульные тесты:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

`jezero_site_selection/site_config.json` хранит исходные точки и границы для настольного редактора; `points/jezero_points.csv` и `public/data/jezero/metadata.json` остаются источниками входных точек/экспорта для ETL и будущего браузерного интерфейса. Координаты двух точек согласованы, но при дальнейших изменениях их нужно синхронизировать.

**Ограничение:** 20 м/пиксель не позволяет доказать безопасность передвижения. Маршрут с поворотами — демонстрационная геометрия, а не сертифицированный расчёт EVA.

