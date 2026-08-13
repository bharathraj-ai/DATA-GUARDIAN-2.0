import { parseEditorFileIdFromPath } from '@/components/view/sudden-exit-client';

describe('parseEditorFileIdFromPath', () => {
    it('reads fileId from editor URL', () => {
        expect(parseEditorFileIdFromPath('/editor/abcToken/file_99', 'abcToken')).toBe('file_99');
    });

    it('returns null on view URL', () => {
        expect(parseEditorFileIdFromPath('/view/abcToken', 'abcToken')).toBeNull();
    });

    it('returns null when token does not match', () => {
        expect(parseEditorFileIdFromPath('/editor/other/file_99', 'abcToken')).toBeNull();
    });
});
