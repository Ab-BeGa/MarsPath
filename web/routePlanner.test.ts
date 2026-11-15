import test from 'node:test'
import assert from 'node:assert/strict'
import { cellAtGrid, type MarsTerrain } from './marsTerrain.ts'
import { planGridRoute, planBrowserRoutes, BROWSER_PLANNER_PENALTY } from './routePlanner.ts'

function mockTerrain(width=5,height=5): MarsTerrain {
  const elevations=new Float32Array(width*height)
  const mask=new Uint8Array(width*height).fill(1)
  return {
    metadata:{
      region_id:'synthetic',source:{product:'synthetic',instrument:'unit',publisher:'test',
        url:'https://example.org',source_sha256:'a'.repeat(64)},
      grid:{width,height,pixel_size_m:[20,20],transform:[20,0,1000,0,-20,2000],
        bounds_projected_m:[1000,2000-20*height,1000+20*width,2000],
        heights_file:'heights.f32',mask_file:'mask.u8',elevation_min_m:0,elevation_max_m:100},
      coordinate_convention:{source_crs_sphere_radius_m:3396190},
      crs_wkt:'PROJCS[Mars Jezero]',checked_points:[],
    },
    heights:elevations,mask,min:0,max:100,validCount:width*height,
  }
}
function xy(terrain:MarsTerrain,r:number,c:number) {
  const cell=cellAtGrid(terrain,c,r)!
  return {x:cell.x,y:cell.y}
}
function equalNear(a:number,b:number,delta=1e-6) {assert.ok(Math.abs(a-b)<=delta,`${a} != ${b}`)}
function independentDijkstra(terrain:MarsTerrain,start:number,goal:number,penalty:number) {
  const {width,height,transform}=terrain.metadata.grid
  const n=width*height
  const cost=new Float64Array(n).fill(Infinity),visited=new Uint8Array(n)
  cost[start]=0
  for(let k=0;k<n;k++){
    let u=-1
    for(let i=0;i<n;i++)if(!visited[i]&&(u<0||cost[i]<cost[u]))u=i
    if(u<0||!Number.isFinite(cost[u]))break
    if(u===goal)return cost[u]
    visited[u]=1
    const r=Math.floor(u/width),c=u%width
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc)continue
      const nr=r+dr,nc=c+dc
      if(nr<0||nc<0||nr>=height||nc>=width)continue
      const v=nr*width+nc
      if(terrain.mask[v]!==1)continue
      if(dr&&dc&&(terrain.mask[(r+dr)*width+c]!==1||
                    terrain.mask[r*width+c+dc]!==1))continue
      const step=Math.hypot(transform[0]*dc,transform[4]*dr)
      const angle=Math.atan(Math.abs(terrain.heights[v]-terrain.heights[u])/step)*180/Math.PI
      const candidate=cost[u]+step*(1+penalty*(angle/10)**2)
      cost[v]=Math.min(cost[v],candidate)
    }
  }
  return Infinity
}
test('on constant DEM A* matches 8-neighbour geometry and reproducible cost',()=>{
  const t=mockTerrain()
  const start=xy(t,0,0),goal=xy(t,4,4)
  const a=planGridRoute(t,start,goal,0)
  equalNear(a.grid_length_m,Math.SQRT2*80)
  equalNear(a.cost,a.grid_length_m)
  assert.equal(a.cells.length,5)
  assert.deepEqual(a.waypoints[0],start)
  assert.deepEqual(a.waypoints.at(-1),goal)
  const b=planGridRoute(t,start,goal,BROWSER_PLANNER_PENALTY)
  assert.deepEqual(a.cells,b.cells)
})
test('slope-penalized route avoids steep synthetic ridge, matching independent Dijkstra',()=>{
  const t=mockTerrain()
  t.heights[2*5+2]=100
  const start=xy(t,2,0),goal=xy(t,2,4)
  const direct=planGridRoute(t,start,goal,0)
  const gentle=planGridRoute(t,start,goal,BROWSER_PLANNER_PENALTY)
  assert.equal(direct.cells.includes(12),true)
  assert.equal(gentle.cells.includes(12),false)
  assert.ok(gentle.grid_length_m>direct.grid_length_m)
  equalNear(direct.cost,independentDijkstra(t,10,14,0))
  equalNear(gentle.cost,independentDijkstra(t,10,14,12))
})
test('valid mask forbids corner cutting, and impossible paths throw',()=>{
  const t=mockTerrain(2,2)
  t.mask.set([1,0,0,1])
  assert.throws(()=>planGridRoute(t,xy(t,0,0),xy(t,1,1),12),/не найден/)
  t.mask[1]=1
  const result=planGridRoute(t,xy(t,0,0),xy(t,1,1),12)
  assert.ok(result.cells.includes(1))
})
test('endpoints reject NoData, out-of-ROI, same cell and invalid cost',()=>{
  const t=mockTerrain()
  t.mask[1]=0
  assert.throws(()=>planGridRoute(t,xy(t,0,0),xy(t,0,1),0),/действительной DEM/)
  assert.throws(()=>planGridRoute(t,xy(t,0,0),xy(t,0,0),0),/разных ячейках/)
  assert.throws(()=>planGridRoute(t,{x:0,y:0},xy(t,0,0),0),/действительной DEM/)
  assert.throws(()=>planGridRoute(t,xy(t,0,0),xy(t,1,1),-2),/параметры/)
})
test('browser result provides live comparison rows, real DEM identity and exact endpoints',()=>{
  const t=mockTerrain()
  t.heights[12]=100
  const start=xy(t,2,0),goal=xy(t,2,4)
  const plan=planBrowserRoutes(t,start,goal)
  assert.equal(plan.comparison.rows.length,6)
  assert.equal(plan.comparison.demVerified,true)
  assert.equal(plan.comparison.source.crs,t.metadata.crs_wkt)
  assert.equal(plan.comparison.source.demHash,t.metadata.source.source_sha256)
  assert.equal(plan.comparison.coverage.partial,false)
  assert.deepEqual(plan.comparison.routes.direct[0],start)
  assert.deepEqual(plan.comparison.routes.detour.at(-1),goal)
  assert.equal(plan.same_grid_path,false)
  assert.ok(plan.comparison.rows[0].detour!>plan.comparison.rows[0].direct!)
  assert.ok(plan.comparison.rows[1].direct!>=0)
})
test('prohibited diagonal grade exits match Python A* hard-cap semantics',()=>{
  const t=mockTerrain(3,3)
  t.heights[1]=100; t.heights[3]=100
  const start=xy(t,0,0),goal=xy(t,1,1)
  const result=planGridRoute(t,start,goal,0,10)
  assert.ok(result.cells.length>=2)
  assert.throws(()=>planGridRoute(t,start,goal,0,10,10),/не найден/)
})
