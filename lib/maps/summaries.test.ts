import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMapSummaries, mergeSummaries, type MapSummary } from './summaries';
const client = vi.hoisted(() => ({ auth: { getUser: vi.fn() }, rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => client }));
const summary = (id: string, title = id): MapSummary => ({id,title,description:'',category:'CS',accent:'lavender',bibbleCount:2,progress:50,updatedAt:'2026-11-22T00:00:00Z'});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','test');
  client.auth.getUser.mockResolvedValue({data:{user:{id:'owner'}}});
});
afterEach(() => vi.unstubAllEnvs());
describe('bounded summary pages', () => {
  it('uses the final included row for the cursor and never requests graph columns',async () => {
    client.rpc.mockResolvedValue({data:Array.from({length:26},(_,i)=>({id:`map-${i}`,title:'Map',description:'',category:'CS',accent:'lavender',updated_at:'2026-11-22T00:00:00Z',bibble_count:10,progress:30})),error:null});
    const page=await listMapSummaries('graph','CS');
    expect(page.maps).toHaveLength(25); expect(page.next?.id).toBe('map-24');
    expect(page.maps[0]).not.toHaveProperty('bibbles');
    expect(client.rpc).toHaveBeenCalledWith('list_learning_map_summaries',expect.objectContaining({p_search:'graph',p_category:'CS',p_limit:25}));
  });
  it('passes the stable timestamp plus ID cursor on subsequent filtered requests',async () => {
    client.rpc.mockResolvedValue({data:[],error:null});
    expect((await listMapSummaries('sql','CS',{updatedAt:'2026-11-22T00:00:00Z',id:'last'})).next).toBeNull();
    expect(client.rpc).toHaveBeenCalledWith('list_learning_map_summaries',expect.objectContaining({p_cursor_id:'last',p_cursor_time:'2026-11-22T00:00:00Z'}));
  });
  it('keeps query and session failures distinct from empty results',async () => {
    client.rpc.mockResolvedValue({data:null,error:{message:'offline'}});
    await expect(listMapSummaries('','All maps')).rejects.toThrow('Cloud maps');
    client.auth.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthRetryableFetchError'}});
    await expect(listMapSummaries('','All maps')).rejects.toThrow('session');
  });
  it('guests do not make cloud RPC calls',async () => {
    client.auth.getUser.mockResolvedValue({data:{user:null}});
    expect(await listMapSummaries('','All maps')).toEqual({maps:[],next:null}); expect(client.rpc).not.toHaveBeenCalled();
  });
  it('deduplicates sample overrides and keeps pending local maps while respecting filters and deletions',() => {
    expect(mergeSummaries([summary('a'),summary('b')],[summary('a','cloud')],[],'','All maps')).toEqual([summary('a','cloud'),summary('b')]);
    expect(mergeSummaries([summary('a'),summary('b')],[summary('a','cloud')],['b'],'cloud','CS')).toEqual([summary('a','cloud')]);
    expect(mergeSummaries([summary('a')],[],[],'','Other')).toEqual([]);
  });
});
