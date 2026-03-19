import { useState, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface EmailComposerProps {
  to: string;
  subject: string;
  signature?: string;
  onSend: (data: {
    htmlBody: string;
    textBody: string;
    subject: string;
    cc: string[];
    bcc: string[];
  }) => void;
  sending?: boolean;
  replyMode?: boolean;
}

export default function EmailComposer({
  to,
  subject: initialSubject,
  signature,
  onSend,
  sending = false,
  replyMode = true,
}: EmailComposerProps) {
  const [subject, setSubject] = useState(initialSubject);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');

  // Build initial content with signature
  const initialContent = signature
    ? `<p></p><br/><p>--</p><p>${signature}</p>`
    : '<p></p>';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      Placeholder.configure({
        placeholder: 'Write your email...',
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[120px] max-h-[400px] overflow-y-auto px-3 py-2 text-sm focus:outline-none',
      },
    },
  });

  // Sync subject if it changes externally (e.g., when switching conversations)
  useEffect(() => {
    setSubject(initialSubject);
  }, [initialSubject]);

  const handleSend = useCallback(() => {
    if (!editor || sending) return;

    const htmlBody = editor.getHTML();
    const textBody = editor.getText();

    if (!textBody.trim()) return;

    const ccList = cc
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bccList = bcc
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    onSend({
      htmlBody,
      textBody,
      subject,
      cc: ccList,
      bcc: bccList,
    });

    // Reset editor after send
    editor.commands.setContent(initialContent);
    setCc('');
    setBcc('');
  }, [editor, sending, cc, bcc, subject, onSend, initialContent]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  const toolbarButtons = [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive('bold'),
      title: 'Bold',
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive('italic'),
      title: 'Italic',
    },
    {
      icon: UnderlineIcon,
      action: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive('underline'),
      title: 'Underline',
    },
    {
      icon: LinkIcon,
      action: setLink,
      active: editor.isActive('link'),
      title: 'Link',
    },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive('bulletList'),
      title: 'Bullet list',
    },
    {
      icon: ListOrdered,
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive('orderedList'),
      title: 'Numbered list',
    },
    {
      icon: Quote,
      action: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive('blockquote'),
      title: 'Blockquote',
    },
  ];

  return (
    <div className="border-t bg-background">
      {/* To line (read-only) */}
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground w-10">To:</span>
        <span className="flex-1 truncate text-xs">{to}</span>
        <button
          type="button"
          onClick={() => setShowCcBcc((prev) => !prev)}
          className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          CC/BCC
          {showCcBcc ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* CC/BCC fields */}
      {showCcBcc && (
        <div className="space-y-1 border-b px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground w-10">CC:</span>
            <Input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="email@example.com, ..."
              className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground w-10">BCC:</span>
            <Input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="email@example.com, ..."
              className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
            />
          </div>
        </div>
      )}

      {/* Subject (only in new email mode, not replies) */}
      {!replyMode && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground w-10">Subj:</span>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
            className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b px-2 py-1">
        {toolbarButtons.map((btn) => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.title}
              type="button"
              onClick={btn.action}
              title={btn.title}
              className={cn(
                'rounded p-1.5 transition-colors hover:bg-accent',
                btn.active && 'bg-accent text-accent-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {/* Send button */}
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={sending || !editor.getText().trim()}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {sending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
