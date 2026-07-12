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

interface CollaborationState {
  // Authorization & Identity
  capabilities: CapabilityFlags;
  myAssignedLevel: number;
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
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  capabilities: { canEdit: false, canPreview: false, canComment: false, canDownload: false },
  myAssignedLevel: 2,
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

  setCapabilities: (caps) => set((state) => ({ capabilities: { ...state.capabilities, ...caps } })),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  updatePresence: (participants, highestLevel) => set({ activeParticipants: participants, highestActiveLevel: highestLevel }),
  addChats: (newChats) => set((state) => {
    // Basic deduplication & unread count logic
    const existingIds = new Set(state.chats.map(c => c.id));
    const uniqueNew = newChats.filter(c => !existingIds.has(c.id));
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
  setAccessStatus: (status) => set({ accessStatus: status })
}));
