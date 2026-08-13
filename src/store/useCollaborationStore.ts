import { create } from 'zustand';
export interface Participant {
  name: string;
  email: string;
  level: number;
}

export interface CapabilityFlags {
  canEdit: boolean;
  canPreview: boolean;
  canComment: boolean;
  canDownload: boolean;
}

export interface ChatMessage {
  id: string;
  senderEmail: string;
  content: string;
  timestamp?: number;
}

export type EditLockUiState = 'idle' | 'editing' | 'takeover_warning' | 'waiting_takeover' | 'can_request' | 'revoked' | 'blocked';

export interface PendingTakeoverView {
  requesterUserId: string;
  requesterUserName: string;
  requesterPriority: number;
  requestedAt: number;
  graceEndsAt: number;
  graceRemainingSeconds: number;
  status: string;
  mode?: 'takeover' | 'request';
}

export interface PublicEditLock {
  documentId: string;
  holder: {
    userId: string;
    userName: string;
    teamId: string;
    priority: number;
    sessionId: string;
    acquiredAt: number;
    lastHeartbeat: number;
    expiresAt: number;
    reservedUntil: number;
  } | null;
  pendingTakeover: PendingTakeoverView | null;
  generation: number;
}

export interface EditLockEventPayload {
  type: string;
  documentId?: string;
  id?: string;
  payload?: Record<string, unknown>;
  requester?: { userId?: string; userName?: string; priority?: number };
  currentEditor?: { userId?: string; userName?: string; priority?: number };
  gracePeriodSeconds?: number;
}

interface CollaborationState {
  // Authorization & Identity
  capabilities: CapabilityFlags;
  myAssignedLevel: number;
  myUserId: string | null;
  highestActiveLevel: number | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  
  // Participants & Chat
  activeParticipants: Participant[];
  chats: ChatMessage[];
  unreadCount: number;
  isChatOpen: boolean;
  
  // Data State
  token: string | null;
  remainingSeconds: number;
  latestFileInputTimestamp: number | null;
  accessStatus: 'active' | 'revoked' | 'expired' | 'session_invalid';

  // Priority edit lock
  editLocks: Record<string, PublicEditLock>;
  lastEditLockEvent: EditLockEventPayload | null;
  editLockUiByFile: Record<string, EditLockUiState>;
  
  // Actions
  setCapabilities: (caps: Partial<CapabilityFlags>) => void;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  updatePresence: (participants: Participant[], highestLevel: number | null) => void;
  addChats: (newChats: ChatMessage[]) => void;
  setChatOpen: (isOpen: boolean) => void;
  updateRemainingSeconds: (seconds: number) => void;
  setLatestFileInputTimestamp: (ts: number | null) => void;
  setToken: (token: string) => void;
  setAccessStatus: (status: 'active' | 'revoked' | 'expired' | 'session_invalid') => void;
  setMyAssignedLevel: (level: number) => void;
  setMyUserId: (userId: string | null) => void;
  setEditLocks: (locks: Record<string, PublicEditLock>) => void;
  upsertEditLock: (fileId: string, lock: PublicEditLock) => void;
  setEditLockEvent: (event: EditLockEventPayload | null) => void;
  setEditLockUi: (fileId: string, ui: EditLockUiState) => void;
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  capabilities: { canEdit: false, canPreview: false, canComment: false, canDownload: false },
  myAssignedLevel: 2,
  myUserId: null,
  highestActiveLevel: null,
  connectionStatus: 'connecting',
  
  activeParticipants: [],
  chats: [],
  unreadCount: 0,
  isChatOpen: false,
  
  token: null,
  remainingSeconds: 0,
  latestFileInputTimestamp: null,
  accessStatus: 'active',

  editLocks: {},
  lastEditLockEvent: null,
  editLockUiByFile: {},

  setCapabilities: (caps) => set((state) => ({ capabilities: { ...state.capabilities, ...caps } })),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  updatePresence: (participants, highestLevel) => set({ activeParticipants: participants, highestActiveLevel: highestLevel }),
  addChats: (newChats) => set((state) => {
    // Basic deduplication & unread count logic
    const existingIds = new Set(state.chats.map(c => c.id));
    const uniqueNew = newChats.filter(c => !c.id || !existingIds.has(c.id));
    if (uniqueNew.length === 0) return state;
    
    return { 
      chats: [...state.chats, ...uniqueNew],
      unreadCount: state.isChatOpen ? 0 : state.unreadCount + uniqueNew.length
    };
  }),
  setChatOpen: (isOpen) => set({ isChatOpen: isOpen, unreadCount: isOpen ? 0 : get().unreadCount }),
  updateRemainingSeconds: (seconds) => set({ remainingSeconds: seconds }),
  setLatestFileInputTimestamp: (ts) => set({ latestFileInputTimestamp: ts }),
  setToken: (token) => set({ token }),
  setAccessStatus: (status) => set({ accessStatus: status }),
  setMyAssignedLevel: (level) => set({ myAssignedLevel: level }),
  setMyUserId: (userId) => set({ myUserId: userId }),
  setEditLocks: (locks) => set((state) => ({ editLocks: { ...state.editLocks, ...locks } })),
  upsertEditLock: (fileId, lock) => set((state) => ({ editLocks: { ...state.editLocks, [fileId]: lock } })),
  setEditLockEvent: (event) => set({ lastEditLockEvent: event }),
  setEditLockUi: (fileId, ui) => set((state) => ({ editLockUiByFile: { ...state.editLockUiByFile, [fileId]: ui } })),
}));
