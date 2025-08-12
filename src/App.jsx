import React, { useEffect, useMemo, useState } from 'react'

const SIZES = ['XS','S','M','L','XL','XXL','XXXL']
const defaultModels = [
  { id: crypto.randomUUID(), name: 'Classic Tee — Black', available: true, image: '' },
  { id: crypto.randomUUID(), name: 'Classic Tee — White', available: true, image: '' },
  { id: crypto.randomUUID(), name: 'Pocket Tee — Navy',  available: false, image: '' },
]

function clsx(...parts){ return parts.filter(Boolean).join(' ') }
function saveLS(key, value){ localStorage.setItem(key, JSON.stringify(value)) }
function loadLS(key, fallback){ try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback } }
function toCSV(rows){
  if(!rows?.length) return ''
  const headers = Object.keys(rows[0])
  const esc = v => v==null ? '' : String(v).replaceAll('"','""')
  return [headers.join(','), ...rows.map(r => headers.map(h => {
    const s = esc(r[h]); return (s.includes(',')||s.includes('\n')||s.includes('"')) ? `"${s}"` : s
  }).join(','))].join('\n')
}
async function postJSON(url, payload){
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
  if(!res.ok) throw new Error(`Sync failed: ${res.status} ${res.statusText}`)
  return await res.json().catch(()=>({}))
}

export default function App(){
  // Hard‑coded Google Sheets webhook URL. All clients will use this URL by default.
  // Updated default Sheets webhook URL. All clients will use this URL for syncing orders.
  const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyZAQ90WOa28d-6qTJ5icXwTUALJmMEArzCnyeSdLr7/dev'
  const [clientName, setClientName] = useState(() => loadLS('ghoco.clientName','Bolos Crew'))
  const lsKey = useMemo(() => `ghoco.${clientName.toLowerCase().replace(/\s+/g,'-')}`, [clientName])
  // Initialize the Sheets webhook with a default value pointing to the provided Apps Script URL.
  // If there is already a saved value in localStorage, that value will override this default.
  // Always use the default webhook and enable auto‑sync. These values do not
  // rely on localStorage so that every visitor has auto‑sync enabled by default.
  const [sheetWebhook, setSheetWebhook] = useState(DEFAULT_WEBHOOK)
  const [autoSync, setAutoSync] = useState(true)

  const patchModels = mods => (mods||[]).map(m => ({ id: m.id ?? crypto.randomUUID(), name: m.name ?? 'Model', available: m.available ?? true, image: m.image ?? '' }))
  const patchOrders = (ords, models) => {
    const byName = Object.fromEntries((models||[]).map(m => [m.name, m]))
    return (ords||[]).map(o => ({
      id: o.id ?? crypto.randomUUID(),
      ts: o.ts ?? new Date().toISOString(),
      client: o.client ?? clientName,
      model: o.model ?? '',
      modelImage: o.modelImage ?? byName[o.model]?.image ?? '',
      size: o.size ?? 'M',
      qty: Number(o.qty ?? 1),
      name: o.name ?? '',
      email: o.email ?? '',
      phone: o.phone ?? '',
      address: o.address ?? '',
      notes: o.notes ?? '',
      mockups: Array.isArray(o.mockups) ? o.mockups : [],
    }))
  }

  const [models, setModels] = useState(() => patchModels(loadLS(`${lsKey}.models`, defaultModels)))
  // Edited models state for the Models tab. Allows staging changes before saving.
  const [editedModels, setEditedModels] = useState(models)
  const [orders, setOrders] = useState(() => patchOrders(loadLS(`${lsKey}.orders`, []), patchModels(loadLS(`${lsKey}.models`, defaultModels))))

  const [tab, setTab] = useState('new')

  // Whenever the selected tab or models change, sync editedModels when entering the Models tab.
  useEffect(() => {
    if (tab === 'models') {
      setEditedModels(models)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, models])
  const [toast, setToast] = useState(null)

  useEffect(() => { saveLS('ghoco.clientName', clientName) }, [clientName])
  useEffect(() => { saveLS(`${lsKey}.models`, models) }, [lsKey, models])
  useEffect(() => { saveLS(`${lsKey}.orders`, orders) }, [lsKey, orders])
  // Persist models and orders in localStorage per client. Webhook and autoSync
  // are intentionally not persisted so that the hard‑coded defaults apply for
  // every visitor.
  // useEffect(() => { saveLS(`${lsKey}.webhook`, sheetWebhook) }, [lsKey, sheetWebhook])
  // useEffect(() => { saveLS(`${lsKey}.autoSync`, autoSync) }, [lsKey, autoSync])

  useEffect(() => {
    const m = patchModels(loadLS(`${lsKey}.models`, defaultModels))
    const o = patchOrders(loadLS(`${lsKey}.orders`, []), m)
    // When changing the client key, reload state from localStorage, using the same default webhook URL if none is stored.
    setModels(m)
    setOrders(o)
    // Always reset the webhook and autoSync to the hard‑coded defaults when the client changes.
    setSheetWebhook(DEFAULT_WEBHOOK)
    setAutoSync(true)
  }, [lsKey])

  const availableModels = models.filter(m => m.available)
  const [form, setForm] = useState({ modelId: availableModels[0]?.id||'', size:'M', qty:1, name:'', email:'', phone:'', address:'', notes:'', mockups:[] })

  useEffect(() => {
    if(!availableModels.find(m => m.id === form.modelId)){
      setForm(f => ({ ...f, modelId: availableModels[0]?.id || '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length, models.map(m=>`${m.id}:${m.available}`).join(',')])

  function handleMockups(files){
    const arr = Array.from(files||[])
    Promise.all(arr.map(file => new Promise(res => {
      const reader = new FileReader(); reader.onload = () => res({ name:file.name, data: reader.result }); reader.readAsDataURL(file)
    }))).then(list => setForm(f => ({ ...f, mockups: [...f.mockups, ...list] })))
  }

  function resetForm(){ setForm({ modelId: availableModels[0]?.id||'', size:'M', qty:1, name:'', email:'', phone:'', address:'', notes:'', mockups:[] }) }
  function notify(msg){ setToast(msg); setTimeout(()=>setToast(null), 2200) }

  async function submitOrder(){
    if(!form.modelId) return notify('Please select a model.')
    if(!form.name) return notify('Please enter a name.')
    const model = models.find(m => m.id === form.modelId)
    const order = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      client: clientName,
      model: model?.name || '',
      modelImage: model?.image || '',
      size: form.size,
      qty: form.qty,
      name: form.name,
      email: form.email,
      phone: form.phone,
      address: form.address,
      notes: form.notes,
      mockups: form.mockups?.map(m => m.data) || [],
    }
    setOrders(o => [order, ...o])
    notify('Order saved.')
    if(autoSync && sheetWebhook){
      try{ await postJSON(sheetWebhook, { type:'order', order }); notify('Synced to Google Sheets.') } catch(e){ notify(e.message) }
    }
    resetForm(); setTab('orders')
  }

  const breakdown = React.useMemo(() => {
    const byModel = {}
    for(const o of orders){ byModel[o.model] ||= Object.fromEntries(SIZES.map(s => [s,0])); byModel[o.model][o.size] += Number(o.qty)||0 }
    return byModel
  }, [orders])

  const [query, setQuery] = useState(''); const [filterModel, setFilterModel] = useState(''); const [filterSize, setFilterSize] = useState('')
  const filtered = React.useMemo(() => orders.filter(o => {
    const matchQ = query ? [o.name,o.email,o.phone,o.address,o.notes,o.model,o.size].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()) : true
    const matchM = filterModel ? o.model === filterModel : true
    const matchS = filterSize ? o.size === filterSize : true
    return matchQ && matchM && matchS
  }), [orders, query, filterModel, filterSize])

  function exportOrdersCSV(){
    const csv = toCSV(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${clientName.replaceAll(' ','_')}_orders.csv`; a.click(); URL.revokeObjectURL(url)
  }
  async function syncSelectedToSheets(rows){
    if(!sheetWebhook) return notify('Add a Google Sheets webhook in Settings.')
    try{ await postJSON(sheetWebhook, { type:'orders', orders: rows }); notify('Orders synced.') } catch(e){ notify(e.message) }
  }

  const TabButton = ({ id, label, icon }) => (
    <button onClick={() => setTab(id)} className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition', tab===id?'bg-black text-white shadow':'bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200')}><span aria-hidden>{icon}</span>{label}</button>
  )
  const Card = ({ title, children, actions }) => (<div className='bg-white rounded-2xl shadow-sm border border-neutral-200 p-5'><div className='flex items-center justify-between mb-4'><h2 className='text-lg font-semibold'>{title}</h2>{actions}</div>{children}</div>)
  const Input = (props) => (<input {...props} className={clsx('w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm','focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black')} />)
  const Label = ({ children }) => (<label className='text-xs font-medium text-neutral-600'>{children}</label>)
  const Field = ({ label, children }) => (<div className='grid gap-1.5'><Label>{label}</Label>{children}</div>)
  const Section = ({ children }) => (<div className='grid gap-5 lg:grid-cols-2'>{children}</div>)

  return (
    <div className='min-h-screen bg-neutral-50 text-neutral-900'>
      <header className='sticky top-0 z-10 bg-neutral-50/80 backdrop-blur border-b border-neutral-200'>
        <div className='max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <div className='h-9 w-9 rounded-xl bg-black text-white flex items-center justify-center font-bold'>G</div>
            <div>
              <div className='text-xs uppercase tracking-wide text-neutral-500'>Gho&co — Orders</div>
              <div className='text-lg font-semibold'>{clientName}</div>
            </div>
          </div>
          <nav className='flex gap-2'>
            <TabButton id='new' label='New Order' icon='🧾' />
            <TabButton id='orders' label='Orders' icon='📋' />
            <TabButton id='models' label='Models' icon='👕' />
            <TabButton id='summary' label='Summary' icon='📊' />
            <TabButton id='settings' label='Settings' icon='⚙️' />
          </nav>
        </div>
      </header>

      <main className='max-w-6xl mx-auto px-4 py-6 grid gap-6'>
        {tab==='new' && (
          <Section>
            <Card title='Order Details'>
              <div className='grid gap-4'>
                <Field label='Model'>
                  <select value={form.modelId} onChange={(e)=>setForm(f=>({...f, modelId:e.target.value}))} className='w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black'>
                    {availableModels.length===0 && (<option value=''>No available models (enable in Models)</option>)}
                    {availableModels.map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}
                  </select>
                </Field>
                {(() => { const model = models.find(m => m.id === form.modelId); return model?.image ? (
                  <div className='border rounded-xl p-3 bg-white flex items-center gap-3'>
                    <img src={model.image} alt='Model preview' className='h-24 w-24 object-cover rounded-lg border' />
                    <div className='text-sm'><div className='font-medium'>Preview</div><div className='text-neutral-500'>Shown for visual reference — not submitted to printer.</div></div>
                  </div>
                ) : null })()}

                <div className='grid md:grid-cols-2 gap-4'>
                  <Field label='Size'>
                    <div className='flex flex-wrap gap-2'>
                      {SIZES.map(s => (<button key={s} onClick={()=>setForm(f=>({...f, size:s}))} className={clsx('px-3 py-2 rounded-xl border text-sm', form.size===s?'bg-black text-white border-black':'bg-white border-neutral-300 hover:bg-neutral-100')}>{s}</button>))}
                    </div>
                  </Field>
                  <Field label='Quantity'>
                    <div className='flex items-center gap-2'>
                      <button onClick={()=>setForm(f=>({...f, qty: Math.max(1, Number(f.qty)-1)}))} className='px-3 py-2 rounded-xl border border-neutral-300' aria-label='Decrease quantity'>−</button>
                      <Input type='number' min={1} value={form.qty} onChange={(e)=>setForm(f=>({...f, qty: Math.max(1, Number(e.target.value))}))} />
                      <button onClick={()=>setForm(f=>({...f, qty: Number(f.qty)+1}))} className='px-3 py-2 rounded-xl border border-neutral-300' aria-label='Increase quantity'>+</button>
                    </div>
                  </Field>
                </div>

                <div className='grid md:grid-cols-2 gap-4'>
                  <Field label='Full name'><Input value={form.name} onChange={(e)=>setForm(f=>({...f, name:e.target.value}))} placeholder='Jane Doe' /></Field>
                  <Field label='Email'><Input type='email' value={form.email} onChange={(e)=>setForm(f=>({...f, email:e.target.value}))} placeholder='jane@email.com' /></Field>
                  <Field label='Phone'><Input value={form.phone} onChange={(e)=>setForm(f=>({...f, phone:e.target.value}))} placeholder='(555) 123‑4567' /></Field>
                  <Field label='Address (optional)'><Input value={form.address} onChange={(e)=>setForm(f=>({...f, address:e.target.value}))} placeholder='Street, City' /></Field>
                </div>

                <Field label='Notes'>
                  <textarea rows={3} value={form.notes} onChange={(e)=>setForm(f=>({...f, notes:e.target.value}))} className='w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black' placeholder='Anything we should know?' />
                </Field>

                <Field label='Mockups (optional)'>
                  <input type='file' accept='image/*' multiple onChange={(e)=>handleMockups(e.target.files)} className='block w-full text-sm text-neutral-600 file:mr-4 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-black file:text-white hover:file:bg-neutral-800' />
                  {form.mockups?.length>0 && (<div className='flex gap-3 flex-wrap mt-2'>{form.mockups.map((m,i)=>(<div key={i} className='relative'><img src={m.data} alt='mockup' className='h-24 w-24 object-cover rounded-xl border' /><button className='absolute -top-2 -right-2 bg-black text-white rounded-full w-6 h-6' onClick={()=>setForm(f=>({...f, mockups: f.mockups.filter((_,idx)=>idx!==i)}))} aria-label='Remove mockup'>×</button></div>))}</div>)}
                </Field>

                <div className='flex justify-end gap-2 pt-2'>
                  <button onClick={resetForm} className='px-4 py-2 rounded-xl border border-neutral-300'>Reset</button>
                  <button onClick={submitOrder} className='px-4 py-2 rounded-xl bg-black text-white'>Submit Order</button>
                </div>
              </div>
            </Card>

            <Card title='Tips & Info'>
              <ul className='text-sm list-disc pl-5 space-y-2'>
                <li>Only <span className='font-medium'>available</span> models appear in the form. Toggle them in the Models tab.</li>
                <li>Add a <span className='font-medium'>model image</span> in the Models tab to preview designs.</li>
                <li>Use the <span className='font-medium'>Settings</span> tab to add a Google Sheets webhook and enable auto‑sync.</li>
                <li>Export a <span className='font-medium'>CSV</span> of orders from the Orders tab.</li>
              </ul>
            </Card>
          </Section>
        )}

        {tab==='orders' && (
          <Card title='Orders' actions={<div className='flex gap-2'><button onClick={exportOrdersCSV} className='px-3 py-2 rounded-xl border border-neutral-300'>Export CSV</button><button onClick={()=>syncSelectedToSheets(filtered)} className='px-3 py-2 rounded-xl bg-black text-white'>Sync Filtered</button></div>}>
            <div className='grid md:grid-cols-4 gap-3 mb-4'>
              <Input placeholder='Search…' value={query} onChange={(e)=>setQuery(e.target.value)} />
              <select value={filterModel} onChange={(e)=>setFilterModel(e.target.value)} className='rounded-xl border border-neutral-300 px-3 py-2 text-sm'><option value=''>All models</option>{[...new Set(orders.map(o=>o.model))].map(m=>(<option key={m} value={m}>{m}</option>))}</select>
              <select value={filterSize} onChange={(e)=>setFilterSize(e.target.value)} className='rounded-xl border border-neutral-300 px-3 py-2 text-sm'><option value=''>All sizes</option>{SIZES.map(s=>(<option key={s} value={s}>{s}</option>))}</select>
              <button onClick={()=>{ setQuery(''); setFilterModel(''); setFilterSize(''); }} className='px-3 py-2 rounded-xl border border-neutral-300'>Clear</button>
            </div>

            <div className='overflow-auto rounded-xl border border-neutral-200'>
              <table className='min-w-full text-sm'>
                <thead className='bg-neutral-100 text-neutral-600'>
                  <tr>
                    <th className='text-left p-3'>Date</th>
                    <th className='text-left p-3'>Model</th>
                    <th className='text-left p-3'>Preview</th>
                    <th className='text-left p-3'>Size</th>
                    <th className='text-left p-3'>Qty</th>
                    <th className='text-left p-3'>Name</th>
                    <th className='text-left p-3'>Email</th>
                    <th className='text-left p-3'>Phone</th>
                    <th className='text-left p-3'>Notes</th>
                    <th className='text-left p-3'>Mockups</th>
                    <th className='text-left p-3'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0 && (<tr><td colSpan={11} className='p-6 text-center text-neutral-475'>No orders yet.</td></tr>)}
                  {filtered.map(o => (
                    <tr key={o.id} className='border-t'>
                      <td className='p-3 whitespace-nowrap'>{new Date(o.ts).toLocaleString()}</td>
                      <td className='p-3'>{o.model}</td>
                      <td className='p-3'>{o.modelImage ? <img src={o.modelImage} alt='preview' className='h-8 w-8 object-cover rounded' /> : <span className='text-xs text-neutral-400'>—</span>}</td>
                      <td className='p-3'>{o.size}</td>
                      <td className='p-3'>{o.qty}</td>
                      <td className='p-3'>{o.name}</td>
                      <td className='p-3'>{o.email}</td>
                      <td className='p-3'>{o.phone}</td>
                      <td className='p-3 max-w-[20ch] truncate' title={o.notes}>{o.notes}</td>
                      <td className='p-3'><div className='flex gap-1 flex-wrap'>{o.mockups?.slice(0,3).map((m,i)=>(<img key={i} src={m} alt='mock' className='h-8 w-8 object-cover rounded' />))}{o.mockups?.length>3 && (<span className='text-xs text-neutral-500'>+{o.mockups.length-3}</span>)}</div></td>
                      <td className='p-3'><button onClick={()=>setOrders(list=>list.filter(x=>x.id!==o.id))} className='px-2 py-1 rounded-lg border border-neutral-300'>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab==='models' && (
          <Card
            title='Models'
            actions={
              <div className='flex gap-2'>
                <button
                  onClick={() => setEditedModels(m => [{ id: crypto.randomUUID(), name: 'New Model', available: true, image: '' }, ...m])}
                  className='px-3 py-2 rounded-xl bg-black text-white'
                >
                  Add Model
                </button>
                <button
                  onClick={() => { setModels(editedModels); notify('Models saved.'); }}
                  className='px-3 py-2 rounded-xl bg-blue-600 text-white'
                >
                  Save
                </button>
              </div>
            }
          >
            <div className='grid gap-3'>
              {editedModels.length===0 && <div className='text-sm text-neutral-500'>No models yet. Add one to get started.</div>}
              {editedModels.map(m => (
                <div key={m.id} className='grid md:grid-cols-12 items-center gap-3 p-3 border rounded-xl bg-white'>
                  <input
                    value={m.name}
                    onChange={e=>setEditedModels(list=>list.map(x=>x.id===m.id?{...x, name:e.target.value}:x))}
                    className='md:col-span-5 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black'
                  />
                  <div className='md:col-span-3 flex items-center gap-3'>
                    {m.image ? (
                      <img src={m.image} alt='model' className='h-12 w-12 object-cover rounded-lg border' />
                    ) : (
                      <div className='h-12 w-12 rounded-lg border grid place-items-center text-[10px] text-neutral-500'>No image</div>
                    )}
                    <label className='text-sm'>
                      <span className='sr-only'>Upload image</span>
                      <input
                        type='file'
                        accept='image/*'
                        onChange={e=>{
                          const file=e.target.files?.[0];
                          if(!file) return;
                          const reader=new FileReader();
                          reader.onload=()=>setEditedModels(list=>list.map(x=>x.id===m.id?{...x, image: reader.result}:x));
                          reader.readAsDataURL(file);
                        }}
                        className='block w-full text-sm text-neutral-600 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-black file:text-white hover:file:bg-neutral-800'
                      />
                    </label>
                    {m.image && (
                      <button
                        onClick={()=>setEditedModels(list=>list.map(x=>x.id===m.id?{...x, image:''}:x))}
                        className='px-3 py-2 rounded-xl border border-neutral-300'
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <label className='md:col-span-2 flex items-center gap-2 text-sm justify-self-start'>
                    <input
                      type='checkbox'
                      checked={m.available}
                      onChange={e=>setEditedModels(list=>list.map(x=>x.id===m.id?{...x, available:e.target.checked}:x))}
                    />
                    Available
                  </label>
                  <div className='md:col-span-2 flex justify-end'>
                    <button
                      onClick={()=>setEditedModels(list=>list.filter(x=>x.id!==m.id))}
                      className='px-3 py-2 rounded-xl border border-neutral-300'
                    >
                      Remove Model
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab==='summary' && (
          <Card title='Per‑Model Size Breakdown'>
            <div className='grid gap-4'>
              {Object.keys(breakdown).length===0 && (<div className='text-sm text-neutral-500'>No orders yet.</div>)}
              {Object.entries(breakdown).map(([model, sizes]) => (
                <div key={model} className='overflow-auto rounded-xl border border-neutral-200'>
                  <table className='min-w-full text-sm'>
                    <thead className='bg-neutral-100 text-neutral-600'><tr><th className='text-left p-3'>{model}</th>{SIZES.map(s=>(<th key={s} className='p-3 text-right'>{s}</th>))}<th className='p-3 text-right'>Total</th></tr></thead>
                    <tbody><tr><td className='p-3 font-medium'>Qty</td>{SIZES.map(s=>(<td key={s} className='p-3 text-right'>{sizes[s]||0}</td>))}<td className='p-3 text-right font-semibold'>{Object.values(sizes).reduce((a,b)=>a+b,0)}</td></tr></tbody>
                  </table>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab==='settings' && (
          <Section>
            <Card title='Client'><div className='grid gap-3'><Field label='Client name'><Input value={clientName} onChange={e=>setClientName(e.target.value)} /></Field><div className='text-xs text-neutral-500'>Data is stored per client name in your browser.</div></div></Card>
            <Card title='Google Sheets Sync'>
              <div className='grid gap-3'>
                <Field label='Webhook URL (Google Apps Script web app)'>
                  {/* Display the webhook URL as read‑only since it is hard‑coded into the app. */}
                  <Input value={sheetWebhook} disabled />
                </Field>
                {/* Auto‑sync is always enabled. Inform the user rather than provide a toggle. */}
                <div className='text-sm font-medium'>Auto‑sync new orders to Sheets is always enabled.</div>
                <div className='text-xs text-neutral-500 leading-relaxed'>
                  <p className='mb-2'>Use a Google Apps Script deployed as a web app to receive JSON and append to a sheet. Expected payloads:</p>
                  <pre className='bg-neutral-100 rounded-xl p-3 overflow-auto text-[11px]'>
{`{ type: "order", order: { ... } }\n{ type: "orders", orders: [ { ... }, { ... } ] }`}
                  </pre>
                </div>
              </div>
            </Card>
          </Section>
        )}
      </main>

      {toast && (<div className='fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white text-sm px-4 py-2 rounded-xl shadow'>{toast}</div>)}
      <footer className='max-w-6xl mx-auto px-4 py-8 text-xs text-neutral-500'>Gho&co · Simple orders app · Local‑first · {new Date().getFullYear()}</footer>
    </div>
  )
}
