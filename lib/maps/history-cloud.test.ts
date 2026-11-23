import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {restoreMapRevision} from "./history";
const state=vi.hoisted(()=>({auth:{getUser:vi.fn()},rpc:vi.fn(),from:vi.fn(),maybeSingle:vi.fn()}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>state}));
const snapshot={id:"s1",map_id:"m1",revision:1,title:"Original",node_count:0,edge_count:0,created_at:"2026-11-22T00:00:00Z",trigger:"save",snapshot_data:{id:"m1",title:"Original",description:"",category:"CS",accent:"lavender",version:1,bibbles:[],edges:[]}};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://fixture.invalid");vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","local-key");state.auth.getUser.mockResolvedValue({data:{user:{id:"owner"}},error:null});const query={select:vi.fn(),eq:vi.fn(),maybeSingle:state.maybeSingle};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);state.from.mockReturnValue(query);state.maybeSingle.mockResolvedValue({data:snapshot,error:null});});
afterEach(()=>vi.unstubAllEnvs());
it("uses the server's committed token and restores through the atomic RPC",async()=>{
 state.rpc.mockResolvedValue({data:7,error:null});const result=await restoreMapRevision({mapId:"m1",snapshotId:"s1",currentRevision:6,expectedRevision:6});
 expect(result).toMatchObject({success:true,newRevision:7,restoredMap:{title:"Original",version:7}});expect(state.rpc).toHaveBeenCalledWith("restore_learning_map_versioned",{p_map_id:"m1",p_snapshot_id:"s1",p_expected_version:6});
});
it("propagates a real stale-restore conflict even if the dialog's two tokens agree",async()=>{
 state.rpc.mockResolvedValue({data:null,error:{code:"PT409"}});const result=await restoreMapRevision({mapId:"m1",snapshotId:"s1",currentRevision:6,expectedRevision:6});expect(result).toMatchObject({success:false,conflictError:true,restoredMap:null});
});
it("does not report a restore when the server cannot confirm the write",async()=>{
 state.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});const result=await restoreMapRevision({mapId:"m1",snapshotId:"s1",currentRevision:6,expectedRevision:6});expect(result.success).toBe(false);expect(result.restoredMap).toBeNull();
});
