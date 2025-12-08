'use client';

import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import {
  collection, query, orderBy, where, getDocs, addDoc, doc, getDoc,
  updateDoc, deleteDoc, setDoc, limit
} from 'firebase/firestore';
import { db, auth, storage } from '../lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { FiPaperclip, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { FaHeart, FaRegHeart } from 'react-icons/fa';

type Attachment = { url: string; type: 'image' | 'video' | 'file' };
type Mention = { userId: string; username: string; displayName?: string };

interface Comment {
  id: string;
  userId: string;
  commentText: string;
  createdAt: number;

  // display/meta
  fullName?: string;
  avatarUrl?: string;
  isProviderAuthor?: boolean;
  displayName?: string;

  attachments?: Attachment[];
  mentions?: Mention[];

  // legacy:
  imageUrls?: string[];
}

interface Reply {
  id: string;
  userId: string;
  text: string;
  createdAt: number;
  fullName?: string;
  avatarUrl?: string;
  isProviderAuthor?: boolean;
  displayName?: string;
}

interface CommentModalProps {
  videoId: string;
  onClose: () => void;
}

type UserProfile = {
  fullName?: string;
  username?: string;
  profilePhoto?: string;
  isProvider?: boolean;

  businessName?: string;
  businessProfilePhoto?: string;
};

// --- helpers for file types
function isVideoMime(m: string) { return m?.startsWith('video/'); }
function isImageMime(m: string) { return m?.startsWith('image/'); }

// --- helpers for @mentions
function nextStringPrefix(s: string) {
  return s + '\uf8ff';
}
function findAtToken(value: string, caret: number) {
  let i = caret - 1;
  while (i >= 0 && !/\s/.test(value[i])) {
    if (value[i] === '@') {
      const token = value.slice(i + 1, caret);
      if (/^[A-Za-z0-9_]{1,32}$/.test(token)) {
        return { start: i, end: caret, query: token };
      }
      break;
    }
    i--;
  }
  return null;
}

// simple debounce
function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function CommentModal({ videoId, onClose }: CommentModalProps) {
  const [user] = useAuthState(auth);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');

  // Who owns the video? (service provider)
  const [providerId, setProviderId] = useState<string | null>(null);

  // Composer state (create)
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; type: 'image' | 'video' | 'file' }[]>([]);
  const [uploading, setUploading] = useState(false);

  // Edit state (top-level comment)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingAttachments, setEditingAttachments] = useState<Attachment[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removedDuringEdit, setRemovedDuringEdit] = useState<string[]>([]);
  const deleteRemovedFilesFromStorage = true;

  // Likes (per comment)
  const [likesCount, setLikesCount] = useState<Record<string, number>>({});
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});

  // Replies
  const [repliesOpen, setRepliesOpen] = useState<Record<string, boolean>>({});
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [loadingReplies, setLoadingReplies] = useState<Record<string, boolean>>({});
  const [repliesCount, setRepliesCount] = useState<Record<string, number>>({}); // NEW: per comment reply count

  // for replace: hidden input per index (editing attachments)
  const replaceInputsRef = useRef<Record<number, HTMLInputElement | null>>({});

  // --- @mentions state (NEW comment composer)
  const newInputRef = useRef<HTMLInputElement | null>(null);
  const [newCaret, setNewCaret] = useState(0);
  const [newMentionOpen, setNewMentionOpen] = useState(false);
  const [newMentionResults, setNewMentionResults] = useState<any[]>([]);
  const [newMentionIndex, setNewMentionIndex] = useState(0);
  const [newMentions, setNewMentions] = useState<Mention[]>([]);

  // --- @mentions state (EDIT composer)
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editCaret, setEditCaret] = useState(0);
  const [editMentionOpen, setEditMentionOpen] = useState(false);
  const [editMentionResults, setEditMentionResults] = useState<any[]>([]);
  const [editMentionIndex, setEditMentionIndex] = useState(0);
  const [editMentions, setEditMentions] = useState<Mention[]>([]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      previews.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  // Fetch providerId (video owner) once
  useEffect(() => {
    (async () => {
      try {
        const vs = await getDoc(doc(db, 'videos', videoId));
        if (vs.exists()) {
          const d = vs.data() as any;
          if (d?.userId) setProviderId(d.userId as string);
        }
      } catch { /* ignore */ }
    })();
  }, [videoId]);

  // Load comments + like counts + liked state + reply counts
  useEffect(() => {
    (async () => {
      const snap = await getDocs(
        query(collection(db, 'videos', videoId, 'comments'), orderBy('createdAt', 'asc'))
      );
      const arr: Comment[] = [];

      const likeCountEntries: [string, number][] = [];
      const likedEntries: [string, boolean][] = [];
      const replyCountEntries: [string, number][] = [];

      for (const d of snap.docs) {
        const data = d.data() as any;

        // Fetch commenter profile for name/avatar/business context
        let prof: UserProfile | null = null;
        try {
          if (data.userId) {
            const uSnap = await getDoc(doc(db, 'users', data.userId));
            if (uSnap.exists()) prof = uSnap.data() as UserProfile;
          }
        } catch { /* ignore */ }

        const isProviderAuthor = providerId ? data.userId === providerId : false;

        const fullName =
          prof?.fullName ||
          prof?.username ||
          'Unknown';

        // Provider shows BUSINESS NAME only
        const displayName = isProviderAuthor
          ? (prof?.businessName || 'Provider')
          : fullName;

        const avatarUrl = isProviderAuthor
          ? (prof?.businessProfilePhoto || prof?.profilePhoto || '')
          : (prof?.profilePhoto || prof?.businessProfilePhoto || '');

        // attachments (new / legacy)
        let attachments: Attachment[] | undefined;
        if (Array.isArray(data.attachments)) {
          attachments = data.attachments.map((a: any) => ({
            url: a.url,
            type: a.type === 'video' ? 'video' : a.type === 'image' ? 'image' : 'file'
          }));
        } else if (Array.isArray(data.imageUrls)) {
          attachments = data.imageUrls.map((u: string) => ({ url: u, type: 'image' }));
        }

        const comment: Comment = {
          id: d.id,
          userId: data.userId,
          commentText: data.commentText || '',
          createdAt: data.createdAt,
          fullName,
          avatarUrl,
          isProviderAuthor,
          displayName,
          attachments,
          mentions: Array.isArray(data.mentions) ? data.mentions : undefined,
          imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : undefined,
        };
        arr.push(comment);

        // Likes
        try {
          const likesSnap = await getDocs(collection(db, 'videos', videoId, 'comments', d.id, 'likes'));
          likeCountEntries.push([d.id, likesSnap.size]);

          if (user) {
            const me = await getDoc(doc(db, 'videos', videoId, 'comments', d.id, 'likes', user.uid));
            likedEntries.push([d.id, me.exists()]);
          }
        } catch { /* ignore */ }

        // Replies count
        try {
          const repSnap = await getDocs(collection(db, 'videos', videoId, 'comments', d.id, 'replies'));
          replyCountEntries.push([d.id, repSnap.size]);
        } catch { /* ignore */ }
      }

      setComments(arr);
      setLikesCount(Object.fromEntries(likeCountEntries));
      setRepliesCount(Object.fromEntries(replyCountEntries));
      if (user) setLikedMap(Object.fromEntries(likedEntries));
      else setLikedMap({});
    })().catch(console.error);
  }, [videoId, providerId, user]);

  // ---------- Create: file picker ----------
  const onPickFiles = (list: FileList | null) => {
    const arr = Array.from(list || []);
    setFiles(arr);
    previews.forEach(p => URL.revokeObjectURL(p.url));
    setPreviews(arr.map(f => ({
      url: URL.createObjectURL(f),
      type: isVideoMime(f.type) ? 'video' : isImageMime(f.type) ? 'image' : 'file'
    })));
  };

  // ---------- Users search for @mentions ----------
  const doUserSearch = useRef(
    debounce(async (prefix: string, setResults: (v: any[]) => void, setOpen: (v: boolean) => void) => {
      if (!prefix) {
        setOpen(false);
        setResults([]);
        return;
      }
      try {
        // Preferred: indexed username query
        const usersRef = collection(db, 'users');
        const qy = query(
          usersRef,
          orderBy('username'),
          where('username', '>=', prefix),
          where('username', '<=', nextStringPrefix(prefix)),
          limit(20)
        );
        const snap = await getDocs(qy);
        if (!snap.empty) {
          setResults(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
          setOpen(true);
          return;
        }
      } catch {
        // fall through to naive fallback if index/orderBy not ready
      }

      // Fallback: fetch a small batch and filter in-memory
      try {
        const usersRef = collection(db, 'users');
        const snap = await getDocs(query(usersRef, limit(50)));
        const list = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(u => (u.username || '').toLowerCase().startsWith(prefix.toLowerCase()));
        setResults(list);
        setOpen(list.length > 0);
      } catch {
        setResults([]);
        setOpen(false);
      }
    }, 160)
  ).current;

  // ---------- NEW comment: insert mention ----------
  function insertNewMention(u: any) {
    if (!newInputRef.current) return;
    const el = newInputRef.current;
    const val = newComment;
    const caret = el.selectionStart ?? val.length;
    const tok = findAtToken(val, caret);
    if (!tok) return;

    const mentionText = `@${u.username}`;
    const before = val.slice(0, tok.start);
    const after  = val.slice(tok.end);
    const next = `${before}${mentionText} ${after}`;
    setNewComment(next);

    setNewMentions(prev => {
      if (prev.some(m => m.userId === u.id)) return prev;
      return [...prev, { userId: u.id, username: u.username, displayName: u.fullName || u.businessName }];
    });

    const newPos = (before + mentionText + ' ').length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newPos, newPos);
    });

    setNewMentionOpen(false);
    setNewMentionResults([]);
  }

  // ---------- EDIT comment: insert mention ----------
  function insertEditMention(u: any) {
    if (!editTextareaRef.current) return;
    const el = editTextareaRef.current;
    const val = editingText;
    const caret = el.selectionStart ?? val.length;
    const tok = findAtToken(val, caret);
    if (!tok) return;

    const mentionText = `@${u.username}`;
    const before = val.slice(0, tok.start);
    const after  = val.slice(tok.end);
    const next = `${before}${mentionText} ${after}`;
    setEditingText(next);

    setEditMentions(prev => {
      if (prev.some(m => m.userId === u.id)) return prev;
      return [...prev, { userId: u.id, username: u.username, displayName: u.fullName || u.businessName }];
    });

    const newPos = (before + mentionText + ' ').length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newPos, newPos);
    });

    setEditMentionOpen(false);
    setEditMentionResults([]);
  }

  // ---------- Create: post ----------
  const postComment = async () => {
    if (!user) return alert('Please sign in to comment.');
    if (!newComment.trim() && files.length === 0) {
      return alert('Type a comment or attach at least one file.');
    }

    setUploading(true);

    // display name
    let fullName = user.displayName || user.email?.split('@')[0] || 'Anon';
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) fullName = (snap.data() as any).fullName || fullName;
    } catch {}

    // upload attachments
    const attachments: Attachment[] = [];
    const legacyImages: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const path = `media/${user.uid}/comments/${videoId}/${Date.now()}_${i}_${f.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, f);
        const url = await getDownloadURL(storageRef);
        const type: Attachment['type'] = isVideoMime(f.type) ? 'video' : isImageMime(f.type) ? 'image' : 'file';
        attachments.push({ url, type });
        if (type === 'image') legacyImages.push(url);
      }
    } catch (err) {
      console.error('Upload failed:', err);
      setUploading(false);
      return alert('Failed to upload file(s). Please try again.');
    }

    await addDoc(collection(db, 'videos', videoId, 'comments'), {
      userId: user.uid,
      commentText: newComment.trim(),
      createdAt: Date.now(),
      fullName,
      attachments: attachments.length ? attachments : undefined,
      imageUrls: legacyImages.length ? legacyImages : undefined,
      mentions: newMentions.length ? newMentions : undefined,
    });

    // reset compose
    setNewComment('');
    setNewMentions([]);
    previews.forEach(p => URL.revokeObjectURL(p.url));
    setFiles([]); setPreviews([]); setUploading(false);

    // refresh (basic)
    const snap = await getDocs(
      query(collection(db, 'videos', videoId, 'comments'), orderBy('createdAt', 'asc'))
    );
    setComments(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any);
  };

  // ========================
  // EDITING ATTACHMENTS
  // ========================

  const beginEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditingText(c.commentText || '');
    setEditingAttachments(c.attachments ? [...c.attachments] : []);
    setRemovedDuringEdit([]);
    setEditMentions(c.mentions ? [...c.mentions] : []);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
    setEditingAttachments([]);
    setRemovedDuringEdit([]);
    setEditMentions([]);
    setEditMentionOpen(false);
    setEditMentionResults([]);
  };

  // Add more attachments while editing
  const onPickMoreDuringEdit = async (list: FileList | null) => {
    if (!user || !editingId) return;
    const arr = Array.from(list || []);
    if (arr.length === 0) return;

    try {
      const newOnes: Attachment[] = [];
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const path = `media/${user.uid}/comments/${videoId}/${Date.now()}_extra_${i}_${f.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, f);
        const url = await getDownloadURL(storageRef);
        const type: Attachment['type'] = isVideoMime(f.type) ? 'video' : isImageMime(f.type) ? 'image' : 'file';
        newOnes.push({ url, type });
      }
      setEditingAttachments(prev => [...prev, ...newOnes]);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload file(s).');
    }
  };

  // Replace an existing attachment by index
  const doReplaceAt = async (idx: number, file: File) => {
    if (!user || editingId == null) return;
    try {
      const path = `media/${user.uid}/comments/${videoId}/${Date.now()}_replace_${idx}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const type: Attachment['type'] = isVideoMime(file.type) ? 'video' : isImageMime(file.type) ? 'image' : 'file';

      // Mark the old one for deletion
      const old = editingAttachments[idx];
      if (old?.url) setRemovedDuringEdit(prev => [...prev, old.url]);

      setEditingAttachments(prev => {
        const copy = [...prev];
        copy[idx] = { url, type };
        return copy;
      });
    } catch (err) {
      console.error('Replace failed:', err);
      alert('Failed to replace file.');
    }
  };

  const onClickReplace = (idx: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = (e: any) => {
      const f: File | undefined = e?.target?.files?.[0];
      if (f) doReplaceAt(idx, f);
    };
    input.click();
  };

  // Remove an attachment (and record old URL for deletion)
  const removeAttachmentAt = (idx: number) => {
    const old = editingAttachments[idx];
    if (old?.url) setRemovedDuringEdit(prev => [...prev, old.url]);
    setEditingAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // Save edit (text + attachments)
  const saveEdit = async () => {
    if (!user || !editingId) return;
    const target = comments.find(c => c.id === editingId);
    if (!target) return;
    if (target.userId !== user.uid) return alert('You can only edit your own comment.');

    const text = editingText.trim();
    if (!text && editingAttachments.length === 0) {
      return alert('Comment cannot be empty.');
    }

    try {
      setSavingEdit(true);

      await updateDoc(doc(db, 'videos', videoId, 'comments', editingId), {
        commentText: text,
        attachments: editingAttachments.length ? editingAttachments : [],
        imageUrls: undefined, // normalize away legacy
        updatedAt: Date.now(),
        mentions: editMentions.length ? editMentions : [],
      });

      // Optionally delete removed files from Storage
      if (deleteRemovedFilesFromStorage) {
        await Promise.all(
          removedDuringEdit.map(async (url) => {
            try {
              await deleteObject(ref(storage, url));
            } catch (e) {
              console.warn('Could not delete old file:', url);
            }
          })
        );
      }

      // Reflect locally
      setComments(prev =>
        prev.map(c =>
          c.id === editingId
            ? { ...c, commentText: text, attachments: [...editingAttachments], mentions: [...editMentions] }
            : c
        )
      );

      cancelEdit();
    } catch (err) {
      console.error('Failed to save edit:', err);
      alert('Failed to save changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete a whole comment
  const removeComment = async (c: Comment) => {
    if (!user) return;
    if (c.userId !== user.uid) return alert('You can only delete your own comment.');
    if (!confirm('Delete this comment?')) return;
    try {
      await deleteDoc(doc(db, 'videos', videoId, 'comments', c.id));

      // Optionally delete attached files
      if (deleteRemovedFilesFromStorage && c.attachments?.length) {
        await Promise.all(
          c.attachments.map(async a => {
            try { await deleteObject(ref(storage, a.url)); } catch {}
          })
        );
      }

      setComments(prev => prev.filter(x => x.id !== c.id));
      setRepliesCount(prev => {
        const copy = { ...prev };
        delete copy[c.id];
        return copy;
      });
      if (editingId === c.id) cancelEdit();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete comment.');
    }
  };

  // ========= Likes (per comment) =========
  const toggleLikeComment = async (commentId: string) => {
    if (!user) return alert('Please sign in to like comments.');
    const likeRef = doc(db, 'videos', videoId, 'comments', commentId, 'likes', user.uid);
    const hasLiked = !!likedMap[commentId];

    try {
      if (hasLiked) {
        await deleteDoc(likeRef);
        setLikedMap(prev => ({ ...prev, [commentId]: false }));
        setLikesCount(prev => ({ ...prev, [commentId]: Math.max(0, (prev[commentId] || 1) - 1) }));
      } else {
        await setDoc(likeRef, { likedAt: Date.now(), userId: user.uid });
        setLikedMap(prev => ({ ...prev, [commentId]: true }));
        setLikesCount(prev => ({ ...prev, [commentId]: (prev[commentId] || 0) + 1 }));
      }
    } catch (e) {
      console.error('toggle like failed', e);
    }
  };

  // ========= Replies =========
  const loadReplies = async (commentId: string) => {
    setLoadingReplies(prev => ({ ...prev, [commentId]: true }));
    try {
      const snap = await getDocs(
        query(collection(db, 'videos', videoId, 'comments', commentId, 'replies'), orderBy('createdAt', 'asc'))
      );

      const list: Reply[] = [];
      for (const d of snap.docs) {
        const r = d.data() as any;

        // profile for reply author
        let prof: UserProfile | null = null;
        try {
          if (r.userId) {
            const uSnap = await getDoc(doc(db, 'users', r.userId));
            if (uSnap.exists()) prof = uSnap.data() as UserProfile;
          }
        } catch {}

        const isProviderAuthor = providerId ? r.userId === providerId : false;
        const fullName = prof?.fullName || prof?.username || 'Unknown';
        const displayName = isProviderAuthor ? (prof?.businessName || 'Provider') : fullName;
        const avatarUrl = isProviderAuthor
          ? (prof?.businessProfilePhoto || prof?.profilePhoto || '')
          : (prof?.profilePhoto || prof?.businessProfilePhoto || '');

        list.push({
          id: d.id,
          userId: r.userId,
          text: r.text || '',
          createdAt: r.createdAt,
          fullName,
          avatarUrl,
          isProviderAuthor,
          displayName,
        });
      }
      setReplies(prev => ({ ...prev, [commentId]: list }));
      setRepliesCount(prev => ({ ...prev, [commentId]: list.length })); // keep counter in sync
    } catch (e) {
      console.error('load replies failed', e);
    } finally {
      setLoadingReplies(prev => ({ ...prev, [commentId]: false }));
    }
  };

  const toggleRepliesOpen = async (commentId: string) => {
    setRepliesOpen(prev => ({ ...prev, [commentId]: !prev[commentId] }));
    // lazy-load on first open
    if (!replies[commentId]) {
      await loadReplies(commentId);
    }
  };

  const postReply = async (commentId: string) => {
    if (!user) return alert('Please sign in to reply.');
    const text = (replyText[commentId] || '').trim();
    if (!text) return;

    // display name
    let fullName = user.displayName || user.email?.split('@')[0] || 'Anon';
    let avatarUrl = '';
    let businessName = '';
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data() as any;
        fullName = d.fullName || fullName;
        avatarUrl = d.businessProfilePhoto || d.profilePhoto || '';
        businessName = d.businessName || '';
      }
    } catch {}

    await addDoc(collection(db, 'videos', videoId, 'comments', commentId, 'replies'), {
      userId: user.uid,
      text,
      createdAt: Date.now(),
      fullName,
    });

    // optimistic UI: append to replies + bump counter
    const isProviderAuthor = providerId ? user.uid === providerId : false;
    const displayName = isProviderAuthor ? (businessName || 'Provider') : fullName;

    setReplies(prev => ({
      ...prev,
      [commentId]: [
        ...(prev[commentId] || []),
        {
          id: `local-${Date.now()}`,
          userId: user.uid,
          text,
          createdAt: Date.now(),
          fullName,
          avatarUrl,
          isProviderAuthor,
          displayName,
        },
      ],
    }));
    setRepliesCount(prev => ({ ...prev, [commentId]: (prev[commentId] || 0) + 1 }));
    setReplyText(prev => ({ ...prev, [commentId]: '' }));
  };

  const normalizedComments = useMemo(() => {
    return comments.map(c => {
      if (c.attachments?.length) return c;
      if (c.imageUrls?.length) {
        return { ...c, attachments: c.imageUrls.map(u => ({ url: u, type: 'image' as const })) };
      }
      return c;
    });
  }, [comments]);

  const renderAttachment = (a: Attachment, i: number) => {
    if (a.type === 'image') {
      return (
        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
           className="block rounded overflow-hidden border" title="View image">
          <img src={a.url} alt={`attachment-${i}`} className="w-full h-full object-cover" />
        </a>
      );
    }
    if (a.type === 'video') {
      return <video key={i} src={a.url} controls playsInline className="w-full h-full object-cover rounded border" />;
    }
    return (
      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
         className="flex items-center justify-center w-full h-full rounded border bg-gray-50 text-xs text-blue-600 underline"
         title="Open file">
        Open file
      </a>
    );
  };

  // simple avatar renderer
  const Avatar = ({ url, isProvider }: { url?: string; isProvider?: boolean }) => {
    return url ? (
      <img
        src={url}
        alt="avatar"
        className={`w-8 h-8 rounded-full object-cover ${isProvider ? 'ring-2 ring-green-500' : ''}`}
      />
    ) : (
      <div className={`w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-semibold ${isProvider ? 'ring-2 ring-green-500' : ''}`}>
        ?
      </div>
    );
  };

  // render comment text with @mentions → profile links
    // render comment text with @mentions → profile links
  function renderWithMentions(text: string, mentions?: Mention[]): ReactNode {
    if (!text) return text;
    if (!mentions || mentions.length === 0) return text;

    const parts: ReactNode[] = [];
    const regex = /@([A-Za-z0-9_]+)/g;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = regex.lastIndex;
      const uname = m[1];

      if (start > last) parts.push(text.slice(last, start));

      const target = mentions.find((x) => x.username === uname);
      if (target) {
        parts.push(
          <a
            key={`${uname}-${start}`}
            href={`/creator/${target.userId}`}
            className="text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            @{uname}
          </a>,
        );
      } else {
        parts.push(text.slice(start, end));
      }

      last = end;
    }

    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  return (
    <div className="fixed inset-0 flex justify-end z-50">
      {/* Overlay */}
      <div onClick={onClose} className="absolute inset-0 bg-black/50" />

      <AnimatePresence>
        <motion.div
          key="commentModal"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="relative bg-white text-gray-900 w-full sm:w-96 h-full shadow-xl"
        >
          <button
            onClick={onClose}
            className="absolute top-2 right-4 text-gray-600 text-2xl hover:text-black"
            aria-label="Close"
          >
            &times;
          </button>

          {/* COMMENTS LIST */}
          <div className="pt-10 px-4 space-y-5 overflow-y-auto max-h-[calc(100vh-280px)]">
            {normalizedComments.map((c) => {
              const isOwner = user?.uid && user.uid === c.userId;
              const isEditing = editingId === c.id;
              const isLiked = likedMap[c.id] || false;
              const likeCount = likesCount[c.id] ?? 0;
              const repCount = repliesCount[c.id] ?? 0;

              return (
                <div key={c.id} className="space-y-2 border-b pb-3">
                  {/* Header with avatar + name + (Provider badge if owner of video) */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar url={c.avatarUrl} isProvider={c.isProviderAuthor} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800 truncate">
                            {c.displayName || c.fullName || 'Unknown'}
                          </span>
                          {c.isProviderAuthor && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 shrink-0">
                              Provider
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Top-right edit/delete */}
                    <div className="flex items-center gap-3 text-sm">
                      {isOwner && !isEditing && (
                        <>
                          <button className="text-gray-600 hover:text-black" onClick={() => beginEdit(c)}>
                            Edit
                          </button>
                          <button className="text-red-600 hover:text-red-700" onClick={() => removeComment(c)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Content / Edit form */}
                  {!isEditing ? (
                    <>
                      {c.commentText && (
                        <p className="text-gray-700 whitespace-pre-wrap">
                          {renderWithMentions(c.commentText, c.mentions)}
                        </p>
                      )}
                      {!!c.attachments?.length && (
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          {c.attachments.map((a, i) => renderAttachment(a, i))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      {/* Text edit + mention dropdown wrapper */}
                      <div className="relative">
                        <textarea
                          ref={editTextareaRef}
                          value={editingText}
                          onChange={(e) => {
                            setEditingText(e.target.value);
                            setEditCaret(e.target.selectionStart || e.target.value.length);
                          }}
                          onSelect={(e: any) => setEditCaret(e.target.selectionStart || 0)}
                          onKeyDown={(e) => {
                            if (editMentionOpen) {
                              if (e.key === 'ArrowDown') { e.preventDefault(); setEditMentionIndex(i => Math.min(i + 1, editMentionResults.length - 1)); return; }
                              if (e.key === 'ArrowUp')   { e.preventDefault(); setEditMentionIndex(i => Math.max(i - 1, 0)); return; }
                              if (e.key === 'Enter')     { e.preventDefault(); insertEditMention(editMentionResults[editMentionIndex]); return; }
                              if (e.key === 'Escape')    { setEditMentionOpen(false); return; }
                            }
                          }}
                          onInput={(e: any) => {
                            const val = e.currentTarget.value;
                            const caret = e.currentTarget.selectionStart || val.length;
                            const tok = findAtToken(val, caret);
                            if (tok) {
                              setEditMentionIndex(0);
                              doUserSearch(tok.query, setEditMentionResults, setEditMentionOpen);
                            } else {
                              setEditMentionOpen(false);
                            }
                          }}
                          className="w-full border rounded p-2 text-sm"
                          rows={3}
                        />
                        {editMentionOpen && editMentionResults.length > 0 && (
                          <div className="absolute z-50 bg-white border rounded shadow w-64 max-h-56 overflow-auto">
                            {editMentionResults.map((u, idx) => (
                              <button
                                key={u.id}
                                onMouseDown={(ev) => { ev.preventDefault(); insertEditMention(u); }}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2 ${idx === editMentionIndex ? 'bg-gray-100' : ''}`}
                              >
                                <img
                                  src={u.businessProfilePhoto || u.profilePhoto || '/avatar.png'}
                                  className="w-7 h-7 rounded-full object-cover"
                                  alt=""
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">@{u.username}</div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {u.businessName || u.fullName || '—'}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Attachments edit grid */}
                      {!!editingAttachments.length && (
                        <div className="grid grid-cols-3 gap-2">
                          {editingAttachments.map((a, idx) => (
                            <div key={idx} className="relative group">
                              <div className="w-full aspect-square rounded overflow-hidden border bg-gray-50">
                                {a.type === 'image' ? (
                                  <img src={a.url} className="w-full h-full object-cover" />
                                ) : a.type === 'video' ? (
                                  <video src={a.url} className="w-full h-full object-cover" controls playsInline />
                                ) : (
                                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                                     className="w-full h-full flex items-center justify-center text-xs underline text-blue-600">
                                    Open file
                                  </a>
                                )}
                              </div>

                              {/* Replace / Remove controls (show on hover) */}
                              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                <button
                                  title="Replace"
                                  onClick={() => onClickReplace(idx)}
                                  className="p-1 rounded bg-white/90 shadow hover:bg-white"
                                >
                                  <FiEdit2 />
                                </button>
                                <button
                                  title="Remove"
                                  onClick={() => removeAttachmentAt(idx)}
                                  className="p-1 rounded bg-white/90 shadow hover:bg-white"
                                >
                                  <FiTrash2 />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add more attachments while editing */}
                      <div className="flex items-center gap-2">
                        <label
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 cursor-pointer border"
                          title="Attach files"
                          aria-label="Attach files"
                        >
                          <FiPaperclip className="text-gray-700" />
                          <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            className="hidden"
                            onChange={(e) => onPickMoreDuringEdit(e.target.files)}
                          />
                        </label>

                        <button
                          onClick={saveEdit}
                          disabled={savingEdit}
                          className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-60"
                        >
                          {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={cancelEdit} className="px-3 py-1 rounded bg-gray-200">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ====== ACTIONS under the comment: Like + count | Reply + Replies counter ====== */}
                  <div className="flex items-center gap-4 mt-1">
                    <button
                      onClick={() => toggleLikeComment(c.id)}
                      className="flex items-center gap-1 text-gray-700 hover:opacity-80"
                      aria-label="Like comment"
                    >
                      {isLiked ? <FaHeart className="text-red-500" /> : <FaRegHeart />}
                      <span className="text-sm">{likeCount}</span>
                    </button>

                    <button
                      onClick={() => toggleRepliesOpen(c.id)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      {repliesOpen[c.id]
                        ? `Hide replies${(repliesCount[c.id] ?? 0) > 0 ? ` (${repliesCount[c.id]})` : ''}`
                        : 'Reply'}
                    </button>

                    {/* show replies counter only if there are replies */}
                    {(repCount > 0 && !repliesOpen[c.id]) && (
                      <span
                        className="text-xs text-gray-600 cursor-pointer hover:underline"
                        onClick={() => toggleRepliesOpen(c.id)}
                        title="View replies"
                      >
                        {repCount} {repCount === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </div>

                  {/* ====== Replies thread (collapsible) ====== */}
                  {repliesOpen[c.id] && (
                    <div className="mt-2 pl-4 border-l">
                      {loadingReplies[c.id] ? (
                        <p className="text-xs text-gray-500">Loading replies…</p>
                      ) : (
                        <>
                          {(replies[c.id] || []).map((r) => (
                            <div key={r.id} className="flex items-start gap-2 mb-2">
                              <Avatar url={r.avatarUrl} isProvider={r.isProviderAuthor} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">
                                    {r.displayName || r.fullName || 'Unknown'}
                                  </span>
                                  {r.isProviderAuthor && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                      Provider
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.text}</p>
                              </div>
                            </div>
                          ))}

                          {/* Reply composer */}
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              value={replyText[c.id] || ''}
                              onChange={(e) =>
                                setReplyText(prev => ({ ...prev, [c.id]: e.target.value }))
                              }
                              placeholder="Write a reply…"
                              className="flex-1 border rounded-full px-3 py-1.5 text-sm"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  postReply(c.id);
                                }
                              }}
                            />
                            <button
                              onClick={() => postReply(c.id)}
                              className="text-blue-600 text-sm font-semibold"
                            >
                              Reply
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* COMPOSER (create new top-level comment) */}
          <div className="p-4 border-t space-y-3 relative">
            {previews.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {previews.map((p, i) => (
                  <div key={i} className="relative w-full aspect-square rounded overflow-hidden border">
                    {p.type === 'image' ? (
                      <img src={p.url} alt={`preview-${i}`} className="w-full h-full object-cover" />
                    ) : p.type === 'video' ? (
                      <video src={p.url} className="w-full h-full object-cover" muted playsInline />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs p-2">
                        File attached
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 relative">
              <label
                className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 cursor-pointer border"
                title="Attach files"
                aria-label="Attach files"
              >
                <FiPaperclip className="text-gray-700" />
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => onPickFiles(e.target.files)}
                />
              </label>

              <input
                ref={newInputRef}
                value={newComment}
                onChange={(e) => {
                  setNewComment(e.target.value);
                  setNewCaret(e.target.selectionStart || e.target.value.length);
                }}
                onSelect={(e: any) => setNewCaret(e.target.selectionStart || 0)}
                onKeyDown={(e) => {
                  if (newMentionOpen) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setNewMentionIndex(i => Math.min(i + 1, newMentionResults.length - 1)); return; }
                    if (e.key === 'ArrowUp')   { e.preventDefault(); setNewMentionIndex(i => Math.max(i - 1, 0)); return; }
                    if (e.key === 'Enter')     { e.preventDefault(); insertNewMention(newMentionResults[newMentionIndex]); return; }
                    if (e.key === 'Escape')    { setNewMentionOpen(false); return; }
                  }
                }}
                onInput={(e: any) => {
                  const val = e.currentTarget.value;
                  const caret = e.currentTarget.selectionStart || val.length;
                  const tok = findAtToken(val, caret);
                  if (tok) {
                    setNewMentionIndex(0);
                    doUserSearch(tok.query, setNewMentionResults, setNewMentionOpen);
                  } else {
                    setNewMentionOpen(false);
                  }
                }}
                placeholder="Add a comment..."
                className="flex-1 border rounded-full px-3 py-2 text-gray-900"
              />

              <button
                onClick={postComment}
                disabled={uploading}
                className="text-blue-600 font-semibold disabled:opacity-60"
              >
                {uploading ? 'Posting…' : 'Post'}
              </button>

              {/* @mentions dropdown for NEW comment */}
              {newMentionOpen && newMentionResults.length > 0 && (
                <div className="absolute -top-2 left-12 -translate-y-full z-50 bg-white border rounded shadow w-64 max-h-56 overflow-auto">
                  {newMentionResults.map((u, idx) => (
                    <button
                      key={u.id}
                      onMouseDown={(ev) => { ev.preventDefault(); insertNewMention(u); }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 ${idx === newMentionIndex ? 'bg-gray-100' : ''}`}
                    >
                      <img
                        src={u.businessProfilePhoto || u.profilePhoto || '/avatar.png'}
                        className="w-7 h-7 rounded-full object-cover"
                        alt=""
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">@{u.username}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {u.businessName || u.fullName || '—'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500">
              You can attach images, GIFs, or short videos to show results or references.
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default CommentModal;