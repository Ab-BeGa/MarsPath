import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { cellAtGrid, cellAtProjected, loadMarsTerrain, type MarsTerrain, type TerrainCell } from './marsTerrain.ts'
import { planBrowserRoutes, type BrowserPlan } from './routePlanner.ts'
import { routeToGrid } from './routeMap.ts'
import { sampleRouteElevation, selectedProfileInterval } from './routeProfile.ts'
import { ElevationProfileChart } from './ElevationProfileChart.tsx'
import { useI18n } from './i18n.tsx'

type Camera = { zoom: number; panX: number; panY: number }
type Size = { width: number; height: number }
type Choosing = 'start' | 'goal' | null
type RouteId = 'direct' | 'detour'
const INITIAL: Camera = {zoom:1,panX:0,panY:0}
const EMPTY = {width:900,height:550}
const step = 20

function renderGaleRelief(terrain: MarsTerrain): HTMLCanvasElement {
  const {width,height} = terrain.metadata.grid
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  const image = ctx.createImageData(width,height)
  const sample = (row:number,col:number,fallback:number) => {
    if (row<0||col<0||row>=height||col>=width) return fallback
    const i=row*width+col
    return terrain.mask[i]===1?terrain.heights[i]:fallback
  }
  const [dx,dy] = terrain.metadata.grid.pixel_size_m
  for (let row=0;row<height;row++) for(let col=0;col<width;col++){
    const i=row*width+col,p=i*4
    if(terrain.mask[i]!==1){image.data.set([13,30,40,255],p);continue}
    const h=terrain.heights[i]
    const z=(h-terrain.min)/Math.max(0.1,terrain.max-terrain.min)
    const shade=Math.max(0.4,Math.min(1.28,0.93
      -((sample(row,col+1,h)-sample(row,col-1,h))/(2*dx))*2
      -((sample(row+1,col,h)-sample(row-1,col,h))/(2*dy))*2))
    image.data[p]=Math.min(255,(48+190*z)*shade)
    image.data[p+1]=Math.min(255,(64+117*z)*shade)
    image.data[p+2]=Math.min(255,(80+80*z)*shade)
    image.data[p+3]=255
  }
  ctx.putImageData(image,0,0)
  return canvas
}
function viewport(size:Size,camera:Camera,terrain:MarsTerrain){
  const {width,height}=terrain.metadata.grid
  const scale=Math.min(size.width/(width+12),size.height/(height+12))*camera.zoom
  return {scale,ox:(size.width-width*scale)/2+camera.panX,
    oy:(size.height-height*scale)/2+camera.panY}
}
function cellForScreen(terrain:MarsTerrain,size:Size,camera:Camera,x:number,y:number){
  const v=viewport(size,camera,terrain)
  return cellAtGrid(terrain,Math.floor((x-v.ox)/v.scale),Math.floor((y-v.oy)/v.scale))
}
function GalePlannerCanvas({terrain}:{terrain:MarsTerrain}) {
  const {t,format} = useI18n()
  const frame=useRef<HTMLDivElement>(null)
  const canvas=useRef<HTMLCanvasElement>(null)
  const gesture=useRef<{x:number;y:number;moved:boolean}|null>(null)
  const [size,setSize]=useState<Size>(EMPTY)
  const [camera,setCamera]=useState<Camera>(INITIAL)
  const [choosing,setChoosing]=useState<Choosing>(null)
  const [start,setStart]=useState<TerrainCell|null>(null)
  const [goal,setGoal]=useState<TerrainCell|null>(null)
  const [result,setResult]=useState<BrowserPlan|null>(null)
  const [error,setError]=useState('')
  const [active,setActive]=useState<RouteId>('direct')
  const [selected,setSelected]=useState<number|null>(null)
  const texture=useMemo(()=>renderGaleRelief(terrain),[terrain])
  const route=result?.comparison.routes[active]
  const profile=useMemo(()=>route?sampleRouteElevation(route,step,point=>{
    const cell=cellAtProjected(terrain,point.x,point.y)
    return cell===null?{elevation_m:null,status:'outside_roi'}:
      cell.elevation===null?{elevation_m:null,status:'nodata'}:
        {elevation_m:cell.elevation,status:'valid'}
  }):null,[route,terrain])
  const highlighted=selected===null||!profile||selected>=profile.samples.length?null:
    selectedProfileInterval(profile,selected)

  useEffect(()=>{
    const el=frame.current
    if(!el)return
    const observer=new ResizeObserver(entries=>{
      const bounds=entries[0]?.contentRect
      if(bounds&&bounds.width>0&&bounds.height>0)
        setSize({width:bounds.width,height:bounds.height})
    })
    observer.observe(el)
    return ()=>observer.disconnect()
  },[])

  useEffect(()=>{
    const node=canvas.current
    const ctx=node?.getContext('2d')
    if(!node||!ctx)return
    const dpr=Math.min(window.devicePixelRatio||1,3)
    node.width=Math.round(size.width*dpr)
    node.height=Math.round(size.height*dpr)
    ctx.setTransform(dpr,0,0,dpr,0,0)
    ctx.fillStyle='#120e13'
    ctx.fillRect(0,0,size.width,size.height)
    const v=viewport(size,camera,terrain)
    const {grid}=terrain.metadata
    const width=grid.width*v.scale,height=grid.height*v.scale
    ctx.imageSmoothingEnabled=true
    ctx.imageSmoothingQuality='high'
    ctx.drawImage(texture,v.ox,v.oy,width,height)
    ctx.strokeStyle='#b99482'
    ctx.lineWidth=1
    ctx.strokeRect(v.ox,v.oy,width,height)
    const at=(point:{x:number;y:number})=>{
      const [sx,,tx,,sy,ty]=grid.transform
      return {x:v.ox+(point.x-tx)/sx*v.scale,
        y:v.oy+(point.y-ty)/sy*v.scale}
    }
    if(result){
      ctx.save()
      ctx.beginPath();ctx.rect(v.ox,v.oy,width,height);ctx.clip()
      for(const id of (active==='direct'?['detour','direct']:['direct','detour']) as RouteId[]){
        const pts=routeToGrid(result.comparison.routes[id],grid.transform)
        ctx.beginPath()
        pts.forEach((p,i)=>i===0?ctx.moveTo(v.ox+p.col*v.scale,v.oy+p.row*v.scale):
          ctx.lineTo(v.ox+p.col*v.scale,v.oy+p.row*v.scale))
        ctx.strokeStyle=id==='direct'?'#55efc4':'#ffad5a'
        ctx.lineWidth=id===active?5:2.5
        ctx.globalAlpha=id===active?1:0.7
        ctx.lineJoin='round'
        ctx.stroke()
      }
      ctx.globalAlpha=1
      if(highlighted){
        const a=at(highlighted.from),b=at(highlighted.to)
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)
        ctx.strokeStyle='#fff7d5';ctx.lineWidth=9;ctx.stroke()
      }
      ctx.restore()
    }
    for(const [cell,name,color] of [
      [start,'A','#55efc4'],[goal,'B','#ffad5a'],
    ] as const){
      if(!cell)continue
      const p=at(cell)
      ctx.beginPath();ctx.arc(p.x,p.y,12,0,Math.PI*2)
      ctx.fillStyle=color;ctx.fill()
      ctx.strokeStyle='#09202a';ctx.lineWidth=2;ctx.stroke()
      ctx.font='bold 12px system-ui'
      ctx.textAlign='center';ctx.fillStyle='#07121e';ctx.fillText(name,p.x,p.y+4)
    }
  },[size,camera,texture,terrain,result,active,highlighted,start,goal])

  const choose=(cell:TerrainCell|null)=>{
    if(!choosing)return
    if(!cell||cell.elevation===null){setError(t('planner.invalidCell'));return}
    setError('');setResult(null);setSelected(null)
    if(choosing==='start'){setStart(cell);setGoal(null);setChoosing('goal')}
    else {setGoal(cell);setChoosing(null)}
  }
  const onUp=(event:PointerEvent<HTMLCanvasElement>)=>{
    const drag=gesture.current
    gesture.current=null
    if(!drag||drag.moved)return
    const rect=event.currentTarget.getBoundingClientRect()
    choose(cellForScreen(terrain,size,camera,event.clientX-rect.left,event.clientY-rect.top))
  }
  const onMove=(event:PointerEvent<HTMLCanvasElement>)=>{
    const drag=gesture.current
    if(!drag)return
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y
    drag.x=event.clientX;drag.y=event.clientY
    if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true
    if(drag.moved)setCamera(c=>({...c,panX:c.panX+dx,panY:c.panY+dy}))
  }
  const useDemo=()=>{
    const base=terrain.metadata.checked_points.find(point=>point.id==='base')
    const science=terrain.metadata.checked_points.find(point=>point.id==='science_target')
    if(!base||!science){setError(t('planner.noDemoPoints'));return}
    const a=cellAtProjected(terrain,base.projected_x_m,base.projected_y_m)
    const b=cellAtProjected(terrain,science.projected_x_m,science.projected_y_m)
    if(!a||!b||a.elevation===null||b.elevation===null){
      setError(t('planner.invalidCell'));return
    }
    setStart(a);setGoal(b);setChoosing(null);setError('');setResult(null);setSelected(null)
  }
  const build=()=>{
    if(!start||!goal)return
    setError('')
    try {
      const planned=planBrowserRoutes(terrain,{x:start.x,y:start.y},{x:goal.x,y:goal.y})
      setResult(planned);setActive('direct');setSelected(null)
    }catch(err){setResult(null);setError(err instanceof Error?err.message:t('planner.noPath'))}
  }
  const summary=result?.comparison
  return <section className="gale-planner-panel" aria-label={t('gale.planner.title')}>
    <div className="gale-planner-heading">
      <div><h3>{t('gale.planner.title')}</h3><p>{t('gale.planner.subtitle')}</p></div>
      <span className="data-pill">{t('region.map.resolution', { size: format(terrain.metadata.grid.pixel_size_m[0]) })}</span>
    </div>
    <div className="browser-planner-actions">
      <button type="button" className={choosing==='start'?'is-selecting':''}
        aria-pressed={choosing==='start'} onClick={()=>{setChoosing('start');setError('')}}>{t('planner.start')}</button>
      <button type="button" className={choosing==='goal'?'is-selecting':''}
        aria-pressed={choosing==='goal'} onClick={()=>{setChoosing('goal');setError('')}}>{t('planner.goal')}</button>
      <button type="button" onClick={useDemo}>{t('planner.demo')}</button>
      <button type="button" className="browser-planner-build" disabled={!start||!goal} onClick={build}>{t('planner.build')}</button>
      <button type="button" onClick={()=>{setStart(null);setGoal(null);setResult(null);setChoosing(null);setSelected(null);setError('')}}>{t('planner.reset')}</button>
    </div>
    <div className="browser-planner-selection" aria-live="polite">
      <span>A: <strong>{start?`${start.col}, ${start.row}`:'—'}</strong></span>
      <span>B: <strong>{goal?`${goal.col}, ${goal.row}`:'—'}</strong></span>
      {choosing&&<span className="browser-planner-hint">{t('planner.clickOnMap')}</span>}
    </div>
    {error&&<p role="alert" className="alert error-alert">{error}</p>}
    <div className="gale-canvas-container" ref={frame}>
      <canvas ref={canvas} className="gale-dem-canvas" tabIndex={0}
        role="application" aria-label={t('gale.planner.canvas')}
        onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);gesture.current={x:e.clientX,y:e.clientY,moved:false}}}
        onPointerMove={onMove} onPointerUp={onUp}
        onPointerCancel={()=>{gesture.current=null}}
        onKeyDown={e=>{
          if(choosing&&e.key==='Enter'){e.preventDefault();choose(cellForScreen(terrain,size,camera,size.width/2,size.height/2))}
          if(e.key==='Escape')setChoosing(null)
        }}/>
      <div className="map-controls" aria-label={t('map.zoom.aria')}>
        <button type="button" onClick={()=>setCamera(c=>({...c,zoom:Math.min(12,c.zoom*1.35)}))}>+</button>
        <span>{format(camera.zoom*100,{maximumFractionDigits:0})}%</span>
        <button type="button" onClick={()=>setCamera(c=>({...c,zoom:Math.max(.75,c.zoom/1.35)}))}>−</button>
        <button type="button" className="reset-map" onClick={()=>setCamera(INITIAL)}>{t('map.zoom.reset')}</button>
      </div>
    </div>
    {result&&summary&&<div className="gale-route-results">
      <p className="browser-planner-result">{result.same_grid_path?t('planner.sameRoute'):t('planner.differentRoute')}</p>
      <div className="route-switcher-buttons">
        <button type="button" aria-pressed={active==='direct'} onClick={()=>{setActive('direct');setSelected(null)}}>{t('planner.shortest')}</button>
        <button type="button" aria-pressed={active==='detour'} onClick={()=>{setActive('detour');setSelected(null)}}>{t('planner.slopeCost')}</button>
      </div>
      <div className="table-scroll" tabIndex={0}>
        <table><thead><tr><th>{t('compare.metric')}</th><th>{t('planner.shortest')}</th>
          <th>{t('planner.slopeCost')}</th></tr></thead>
          <tbody>{summary.rows.map(item=><tr key={item.label}>
            <th>{item.label} {item.unit}</th>
            <td>{item.direct===null?'—':format(item.direct,{maximumFractionDigits:2})}</td>
            <td>{item.detour===null?'—':format(item.detour,{maximumFractionDigits:2})}</td>
          </tr>)}</tbody></table>
      </div>
      {profile&&<ElevationProfileChart profile={profile} activeRoute={active}
        selectedIndex={selected} onSelect={setSelected}/>}
    </div>}
    <p className="browser-planner-caveat">{t('gale.planner.limitations')}</p>
    <p className="gale-dem-source">{t('gale.planner.source')}{' '}
      <a href={terrain.metadata.source.url} rel="noopener noreferrer" target="_blank">
        NASA/JPL-Caltech/USGS — MSL Gale DEM</a>
      {' · '}{t('gale.planner.averaged')}</p>
  </section>
}

/** Always fail closed: never calculate from the rendered MOLA/CTX JPEG/WebP
 * unless a verified Gale-specific numerical metadata+height+mask set loads.
 */
export function GaleRoutePlanner(){
  const {t} = useI18n()
  const [terrain,setTerrain]=useState<MarsTerrain|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    void loadMarsTerrain('/data/gale/').then(data=>{
      if(active){
        if(data.metadata.region_id!=='gale_crater_curiosity_demo')throw Error('Incorrect Gale DEM identity')
        setTerrain(data)
      }
    }).catch(reason=>{
      if(active)setError(reason instanceof Error?reason.message:String(reason))
    })
    return ()=>{active=false}
  },[])
  if(terrain)return <GalePlannerCanvas terrain={terrain}/>
  return <section className="gale-planner-panel">
    <span className="section-kicker">{t('gale.planner.badge')}</span>
    <h3>{t('gale.planner.title')}</h3>
    {error?<p className="alert" role="status">{t('gale.planner.missing')}</p>:
      <p role="status">{t('app.loadingDEM')}</p>}
    <p className="browser-planner-caveat">{t('gale.planner.limitations')}</p>
  </section>
}
