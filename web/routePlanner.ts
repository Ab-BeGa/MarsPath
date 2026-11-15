/** Deterministic browser A* on the same original Mars CTX DEM as the Python
 * detour_planner.py. No artificial obstacles, Earth coordinates or EVA claims.
 * Both routes use 8-connected valid DEM cells without diagonal corner cuts.
 */
import { cellAtGrid, cellAtProjected, type MarsTerrain } from './marsTerrain.ts'
import type { MapPoint } from './routeMap.ts'
import { measureRouteSlope, DEFAULT_SLOPE_THRESHOLDS, type SlopeReport } from './routeSlopes.ts'
import type { RouteComparison, ComparisonRow } from './compareRoutes.ts'

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [-1, 1], [0, 1], [1, 1],
  [1, 0], [1, -1], [0, -1], [-1, -1],
]
export const BROWSER_PLANNER_PENALTY = 12
export const BROWSER_PLANNER_REFERENCE_SLOPE_DEG = 10
export const BROWSER_PLANNER_SAMPLE_STEP_M = 20

export type PlannedGridRoute = {
  waypoints: MapPoint[]
  cells: number[]
  grid_length_m: number
  cost: number
  nodes_expanded: number
  max_grid_edge_slope_deg: number
}

/** Binary min-heap with deterministic tie-breaking; duplicate queue entries
 * may exist but outdated entries are ignored using the gScore array.
 */
class MinHeap {
  private data: Array<{ id: number; cost: number; f: number }> = []
  get length() { return this.data.length }
  push(value: { id: number; cost: number; f: number }) {
    const data = this.data
    let i = data.length
    data.push(value)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(data[p], value)) break
      data[i] = data[p]
      i = p
    }
    data[i] = value
  }
  pop() {
    const data = this.data
    const result = data[0]
    const last = data.pop()
    if (!data.length || !last) return result
    let i = 0
    while (i * 2 + 1 < data.length) {
      const a = i * 2 + 1
      const b = a + 1
      const child = b < data.length && this.less(data[b], data[a]) ? b : a
      if (this.less(last, data[child])) break
      data[i] = data[child]
      i = child
    }
    data[i] = last
    return result
  }
  private less(a: { id: number; cost: number; f: number },
    b: { id: number; cost: number; f: number }) {
    return a.f < b.f || (a.f === b.f && (a.cost < b.cost ||
      (a.cost === b.cost && a.id <= b.id)))
  }
}

function valid(terrain: MarsTerrain, row: number, col: number): boolean {
  const {width, height} = terrain.metadata.grid
  return row >= 0 && col >= 0 && row < height && col < width &&
    terrain.mask[row * width + col] === 1 &&
    Number.isFinite(terrain.heights[row * width + col])
}

function endpoint(terrain: MarsTerrain, position: MapPoint) {
  const cell = cellAtProjected(terrain, position.x, position.y)
  if (!cell || cell.elevation === null) throw new Error('Начало или цель вне покрытия действительной DEM')
  return cell
}

export function planGridRoute(
  terrain: MarsTerrain, start: MapPoint, goal: MapPoint,
  penaltyWeight: number,
  referenceSlopeDeg = BROWSER_PLANNER_REFERENCE_SLOPE_DEG,
  maxSlopeDeg: number | null = null,
): PlannedGridRoute {
  if (![penaltyWeight, referenceSlopeDeg].every(Number.isFinite) || penaltyWeight < 0 ||
      referenceSlopeDeg <= 0 || referenceSlopeDeg >= 90 ||
      (maxSlopeDeg !== null && (!Number.isFinite(maxSlopeDeg) || maxSlopeDeg <= 0 || maxSlopeDeg >= 90))) {
    throw new Error('Неверные параметры функции стоимости A*')
  }
  const s = endpoint(terrain, start)
  const g = endpoint(terrain, goal)
  const { width, height, transform } = terrain.metadata.grid
  const startId = s.row * width + s.col
  const goalId = g.row * width + g.col
  if (startId === goalId) throw new Error('Начальная и конечная точки должны быть в разных ячейках DEM')
  const count = width * height
  const gScore = new Float64Array(count)
  gScore.fill(Infinity)
  const parent = new Int32Array(count)
  parent.fill(-1)
  const heap = new MinHeap()
  gScore[startId] = 0
  const step = (dr: number, dc: number) => Math.hypot(
    transform[0] * dc + transform[1] * dr,
    transform[3] * dc + transform[4] * dr)
  const heuristic = (row: number, col: number) => Math.hypot(
    transform[0] * (g.col - col) + transform[1] * (g.row - row),
    transform[3] * (g.col - col) + transform[4] * (g.row - row))
  heap.push({ id: startId, cost: 0, f: heuristic(s.row, s.col) })
  let expanded = 0
  let reached = false
  while (heap.length) {
    const current = heap.pop()!
    if (current.cost > gScore[current.id] + 1e-9) continue
    expanded++
    if (current.id === goalId) { reached = true; break }
    const row = Math.floor(current.id / width)
    const col = current.id % width
    for (const [dr,dc] of DIRECTIONS) {
      const nr = row + dr
      const nc = col + dc
      if (!valid(terrain, nr, nc)) continue
      // Same strict corner-cut rule as detour_planner.py.
      if (dr && dc && (!valid(terrain, row + dr, col) || !valid(terrain, row, col + dc))) continue
      const next = nr * width + nc
      const length = step(dr,dc)
      const grade = Math.atan(Math.abs(terrain.heights[current.id] - terrain.heights[next]) / length) * 180 / Math.PI
      if (maxSlopeDeg !== null && grade > maxSlopeDeg + 1e-10) continue
      if (maxSlopeDeg !== null && dr && dc) {
        const sideA = (row + dr) * width + col
        const sideB = row * width + (col + dc)
        const gradeA = Math.atan(Math.abs(terrain.heights[current.id] - terrain.heights[sideA]) /
          step(dr,0)) * 180 / Math.PI
        const gradeB = Math.atan(Math.abs(terrain.heights[current.id] - terrain.heights[sideB]) /
          step(0,dc)) * 180 / Math.PI
        if (gradeA > maxSlopeDeg + 1e-10 || gradeB > maxSlopeDeg + 1e-10) continue
      }
      const candidate = current.cost + length * (1 + penaltyWeight * (grade / referenceSlopeDeg) ** 2)
      if (candidate + 1e-9 < gScore[next]) {
        gScore[next] = candidate
        parent[next] = current.id
        heap.push({id:next, cost:candidate, f:candidate+heuristic(nr,nc)})
      }
    }
  }
  if (!reached) throw new Error('Маршрут по действительным ячейкам DEM не найден')
  const cells: number[] = []
  let cursor = goalId
  while (cursor !== -1) {
    cells.push(cursor)
    if (cursor === startId) break
    cursor = parent[cursor]
  }
  if (cells[cells.length-1] !== startId) throw new Error('Повреждён путь восстановления A*')
  cells.reverse()
  if (cells.length > 20_000) throw new Error('Маршрут слишком длинный для интерактивного профиля')
  let gridLength = 0
  let maxGrade = 0
  for (let i=1; i<cells.length; i++) {
    const a=cells[i-1], b=cells[i]
    const ar=Math.floor(a/width), ac=a%width
    const br=Math.floor(b/width), bc=b%width
    const length=step(br-ar, bc-ac)
    gridLength+=length
    maxGrade=Math.max(maxGrade,Math.atan(Math.abs(terrain.heights[a]-terrain.heights[b])/length)*180/Math.PI)
  }
  // Python planner compresses only collinear adjacent grid edges.
  const kept: number[] = [0]
  let previousDirection: string | null = null
  for (let k=1; k<cells.length; k++) {
    const a=cells[k-1], b=cells[k]
    const direction = `${Math.floor(b/width)-Math.floor(a/width)},${b%width-a%width}`
    if (previousDirection !== null && direction !== previousDirection) kept.push(k-1)
    previousDirection = direction
  }
  kept.push(cells.length-1)
  const deduplicated = [...new Set(kept)]
  const waypoints: MapPoint[] = [{x:start.x,y:start.y}]
  for (const k of deduplicated) {
    const id=cells[k], point=cellAtGrid(terrain,id%width,Math.floor(id/width))!
    if (Math.hypot(point.x-waypoints[waypoints.length-1].x,point.y-waypoints[waypoints.length-1].y)>0.1) {
      waypoints.push({x:point.x,y:point.y})
    }
  }
  if (Math.hypot(goal.x-waypoints[waypoints.length-1].x,goal.y-waypoints[waypoints.length-1].y)>0.1) {
    waypoints.push({x:goal.x,y:goal.y})
  } else waypoints[waypoints.length-1] = {x:goal.x,y:goal.y}
  if (waypoints.length<2 || waypoints.some((p,i) => i>0 &&
      Math.hypot(p.x-waypoints[i-1].x,p.y-waypoints[i-1].y)<1e-7)) {
    throw new Error('Маршрут содержит повторяющиеся контрольные точки')
  }
  return {waypoints,cells,grid_length_m:gridLength,cost:gScore[goalId],
    nodes_expanded:expanded,max_grid_edge_slope_deg:maxGrade}
}

function metrics(report: SlopeReport): Array<number | null> {
  let ascent=0, maxGrade: number | null=null, steepCount=0
  for (const interval of report.intervals) {
    if (interval.grade_deg !== null) {
      maxGrade=Math.max(maxGrade??0, interval.grade_deg)
      if (interval.to.elevation_m! > interval.from.elevation_m!) {
        ascent+=interval.to.elevation_m!-interval.from.elevation_m!
      }
      if (interval.band==='steep'||interval.band==='very_steep') steepCount++
    }
  }
  const measuredLength=report.total_m-report.unknown_m
  return [report.total_m,measuredLength>0?ascent:null,maxGrade,
    measuredLength>0?steepCount:null,measuredLength>0?report.difficult_m:null,report.unknown_m]
}

export type BrowserPlan = {
  comparison: RouteComparison
  direct: PlannedGridRoute
  detour: PlannedGridRoute
  same_grid_path: boolean
}

export function planBrowserRoutes(terrain: MarsTerrain, start: MapPoint, goal: MapPoint): BrowserPlan {
  const direct=planGridRoute(terrain,start,goal,0)
  const detour=planGridRoute(terrain,start,goal,BROWSER_PLANNER_PENALTY)
  const shortStats=measureRouteSlope(terrain,direct.waypoints,DEFAULT_SLOPE_THRESHOLDS,BROWSER_PLANNER_SAMPLE_STEP_M)
  const gentleStats=measureRouteSlope(terrain,detour.waypoints,DEFAULT_SLOPE_THRESHOLDS,BROWSER_PLANNER_SAMPLE_STEP_M)
  const rowsSpec: Array<{label:string;unit:string}>=[
    {label:'Длина маршрута',unit:'м'},
    {label:'Набор высоты',unit:'м'},
    {label:'Максимальный измеренный уклон',unit:'°'},
    {label:'Крутые интервалы',unit:''},
    {label:'Длина крутых интервалов',unit:'м'},
    {label:'Участки без данных',unit:'м'},
  ]
  const a=metrics(shortStats),b=metrics(gentleStats)
  const rows: ComparisonRow[]=rowsSpec.map((item,i)=>({
    ...item,direct:a[i],detour:b[i],delta:a[i]===null||b[i]===null?null:b[i]!-a[i]!,
  }))
  const coverageA=100*(shortStats.total_m-shortStats.unknown_m)/shortStats.total_m
  const coverageB=100*(gentleStats.total_m-gentleStats.unknown_m)/gentleStats.total_m
  return {
    comparison: {rows,coverage:{direct:coverageA,detour:coverageB,
      partial:shortStats.unknown_m>0||gentleStats.unknown_m>0},
      demVerified:true,origin:'browser',routes:{direct:direct.waypoints,detour:detour.waypoints},
      source:{crs:terrain.metadata.crs_wkt,demHash:terrain.metadata.source.source_sha256,
        step:BROWSER_PLANNER_SAMPLE_STEP_M}},
    direct,detour,
    same_grid_path:direct.cells.length===detour.cells.length&&
      direct.cells.every((id,i)=>id===detour.cells[i]),
  }
}
