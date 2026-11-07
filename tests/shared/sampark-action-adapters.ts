// Explicit browser-fixture boundaries for production Students/Student360.
// These fixtures do not exercise assignment or photo writes; all writes refuse.
export async function taskAssignmentContextAction() { return {students:[],fields:[],owners:[],subjects:[],papers:[]}; }
export async function previewTeacherTasksAction() { throw new Error("Synthetic assignment refused"); }
export async function createTeacherTasksAction() { return {ok:false as const,reason:"recipient_changed" as const}; }
export async function openPhotoEditorAction() { return {ok:false as const,reason:"not_permitted"}; }
export async function saveProfilePhotoAction() { return {ok:false as const,reason:"not_permitted"}; }
export async function reviewPhotoAction() { return {ok:false as const,reason:"not_permitted"}; }
// Teachers' work delivery (D-521): the send list the assignment sheet opens after
// "Give work". Nothing is read or noted here; every call refuses.
export async function previewTaskDeliveryAction() { return {ok:false as const,reason:"unavailable" as const}; }
export async function confirmTaskDeliveryAction() { return {ok:false as const,reason:"unavailable" as const}; }
export async function reconcileTaskDeliveryAction() { return false; }
export async function taskSendQueueAction() { return {ok:false as const}; }
export async function recordTaskSentAction() { return {ok:false as const,reason:"unavailable" as const}; }
