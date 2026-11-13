using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class AspaceWin32Embed
{
    private const int GWL_STYLE = -16;
    private const int GWL_EXSTYLE = -20;

    private const long WS_VISIBLE = 0x10000000L;
    private const long WS_CAPTION = 0x00C00000L;
    private const long WS_THICKFRAME = 0x00040000L;
    private const long WS_MINIMIZEBOX = 0x00020000L;
    private const long WS_MAXIMIZEBOX = 0x00010000L;
    private const long WS_SYSMENU = 0x00080000L;
    private const long WS_POPUP = 0x80000000L;
    private const long WS_CHILD = 0x40000000L;
    private const long WS_CLIPSIBLINGS = 0x04000000L;
    private const long WS_CLIPCHILDREN = 0x02000000L;

    private const long WS_EX_TOOLWINDOW = 0x00000080L;
    private const long WS_EX_APPWINDOW = 0x00040000L;
    private const long WS_EX_DLGMODALFRAME = 0x00000001L;
    private const long WS_EX_WINDOWEDGE = 0x00000100L;
    private const long WS_EX_CLIENTEDGE = 0x00000200L;
    private const long WS_EX_STATICEDGE = 0x00020000L;

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_HIDEWINDOW = 0x0080;
    private const uint SWP_ASYNCWINDOWPOS = 0x4000;

    private const uint GA_PARENT = 1;
    private const uint GW_OWNER = 4;
    private const uint WM_CLOSE = 0x0010;
    private const uint WM_ACTIVATE = 0x0006;

    private static readonly IntPtr HWND_TOP = new IntPtr(0);
    private static readonly object OutputLock = new object();

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hwndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

    private static IntPtr GetWindowLongPtrAny(IntPtr hWnd, int nIndex)
    {
        if (IntPtr.Size == 8) return GetWindowLongPtr64(hWnd, nIndex);
        return new IntPtr(GetWindowLong32(hWnd, nIndex));
    }

    private static IntPtr SetWindowLongPtrAny(IntPtr hWnd, int nIndex, IntPtr dwNewLong)
    {
        if (IntPtr.Size == 8) return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
        return new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
    }

    private static void EnableDpiAwareness()
    {
        try
        {
            // PER_MONITOR_AWARE_V2 = -4
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        }
        catch
        {
        }
        try
        {
            SetProcessDPIAware();
        }
        catch
        {
        }
    }

    private static double GetDpiScale(IntPtr hwnd)
    {
        try
        {
            if (hwnd != IntPtr.Zero)
            {
                uint dpi = GetDpiForWindow(hwnd);
                if (dpi >= 96) return dpi / 96.0;
            }
        }
        catch
        {
        }
        return 1.0;
    }

    private static IntPtr ParseHandle(string value)
    {
        if (string.IsNullOrEmpty(value)) return IntPtr.Zero;
        long parsed;
        if (!long.TryParse(value.Trim(), out parsed)) return IntPtr.Zero;
        return new IntPtr(parsed);
    }

    private static string HandleToString(IntPtr handle)
    {
        return handle.ToInt64().ToString();
    }

    private static string GetWindowClass(IntPtr hWnd)
    {
        StringBuilder cls = new StringBuilder(128);
        GetClassName(hWnd, cls, cls.Capacity);
        return cls.ToString();
    }

    private static List<string> ListChromeWindows()
    {
        List<string> handles = new List<string>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            if (GetAncestor(hWnd, GA_PARENT) != IntPtr.Zero && GetParent(hWnd) != IntPtr.Zero) return true;
            if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return true;
            long exStyle = GetWindowLongPtrAny(hWnd, GWL_EXSTYLE).ToInt64();
            if ((exStyle & WS_EX_TOOLWINDOW) != 0) return true;
            if (GetWindowClass(hWnd) != "Chrome_WidgetWin_1") return true;
            RECT r;
            if (!GetWindowRect(hWnd, out r)) return true;
            if ((r.Right - r.Left) < 150 || (r.Bottom - r.Top) < 150) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            try
            {
                using (Process p = Process.GetProcessById((int)pid))
                {
                    if (string.Equals(p.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase))
                    {
                        handles.Add(HandleToString(hWnd));
                    }
                }
            }
            catch
            {
            }
            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static bool MeasureChromeInsets(IntPtr chromeHwnd, out int left, out int top, out int right, out int bottom)
    {
        left = 0;
        top = 0;
        right = 0;
        bottom = 0;
        RECT outer;
        if (!IsWindow(chromeHwnd) || !GetWindowRect(chromeHwnd, out outer)) return false;
        int outerW = outer.Right - outer.Left;
        int outerH = outer.Bottom - outer.Top;
        if (outerW <= 0 || outerH <= 0) return false;

        RECT bestInner = new RECT();
        long bestArea = 0;
        bool found = false;

        EnumChildWindows(chromeHwnd, delegate(IntPtr child, IntPtr lParam)
        {
            if (!IsWindowVisible(child)) return true;
            if (GetWindowClass(child) != "Chrome_RenderWidgetHostHWND") return true;
            RECT r;
            if (!GetWindowRect(child, out r)) return true;
            int w = r.Right - r.Left;
            int h = r.Bottom - r.Top;
            if (w <= 0 || h <= 0) return true;
            long area = (long)w * (long)h;
            if (area > bestArea)
            {
                bestArea = area;
                bestInner = r;
                found = true;
            }
            return true;
        }, IntPtr.Zero);

        if (!found) return false;
        if ((bestInner.Right - bestInner.Left) < Math.Max(50, outerW / 2)) return false;
        if ((bestInner.Bottom - bestInner.Top) < Math.Max(50, outerH / 2)) return false;

        int l = bestInner.Left - outer.Left;
        int t = bestInner.Top - outer.Top;
        int rInset = outer.Right - bestInner.Right;
        int bInset = outer.Bottom - bestInner.Bottom;

        if (l < 0 || l > 40) l = Math.Max(0, Math.Min(l, 40));
        if (t < 0 || t > 120) t = Math.Max(0, Math.Min(t, 120));
        if (rInset < 0 || rInset > 40) rInset = Math.Max(0, Math.Min(rInset, 40));
        if (bInset < 0 || bInset > 40) bInset = Math.Max(0, Math.Min(bInset, 40));

        left = l;
        top = t;
        right = rInset;
        bottom = bInset;
        return true;
    }

    private static void StripFrameStyles(IntPtr childHwnd)
    {
        long style = GetWindowLongPtrAny(childHwnd, GWL_STYLE).ToInt64();
        style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
        style |= (WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN);
        SetWindowLongPtrAny(childHwnd, GWL_STYLE, new IntPtr(style));

        long exStyle = GetWindowLongPtrAny(childHwnd, GWL_EXSTYLE).ToInt64();
        exStyle &= ~(WS_EX_APPWINDOW | WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE);
        SetWindowLongPtrAny(childHwnd, GWL_EXSTYLE, new IntPtr(exStyle));
    }

    private sealed class EmbeddedEntry
    {
        public IntPtr ParentHwnd;
        public IntPtr ChildHwnd;
        public Form HostForm;
        public IntPtr HostHwnd;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public bool Visible;
        public int LeftInset;
        public int TopInset;
        public int RightInset;
        public int BottomInset;
        public bool InsetsMeasured;
    }

    private static readonly Dictionary<long, EmbeddedEntry> Entries = new Dictionary<long, EmbeddedEntry>();
    private static Control UiMarshaller;
    private static System.Windows.Forms.Timer WatchdogTimer;

    private static EmbeddedEntry CreateOrUpdateHost(IntPtr parentHwnd, IntPtr childHwnd, int x, int y, int width, int height, bool visible)
    {
        long key = childHwnd.ToInt64();
        EmbeddedEntry entry;
        if (!Entries.TryGetValue(key, out entry) || entry.HostForm == null || entry.HostForm.IsDisposed || !IsWindow(entry.HostHwnd))
        {
            Form host = new Form();
            host.FormBorderStyle = FormBorderStyle.None;
            host.ShowInTaskbar = false;
            host.StartPosition = FormStartPosition.Manual;
            host.Location = new Point(-32000, -32000);
            host.Size = new Size(Math.Max(1, width), Math.Max(1, height));
            host.BackColor = Color.FromArgb(0x18, 0x18, 0x18);
            IntPtr hostHwnd = host.Handle;

            long style = GetWindowLongPtrAny(hostHwnd, GWL_STYLE).ToInt64();
            style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU | WS_VISIBLE);
            style |= (WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
            SetWindowLongPtrAny(hostHwnd, GWL_STYLE, new IntPtr(style));

            long exStyle = GetWindowLongPtrAny(hostHwnd, GWL_EXSTYLE).ToInt64();
            exStyle &= ~(WS_EX_APPWINDOW | WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE);
            SetWindowLongPtrAny(hostHwnd, GWL_EXSTYLE, new IntPtr(exStyle));

            SetParent(hostHwnd, parentHwnd);

            entry = new EmbeddedEntry();
            entry.ParentHwnd = parentHwnd;
            entry.ChildHwnd = childHwnd;
            entry.HostForm = host;
            entry.HostHwnd = hostHwnd;
            Entries[key] = entry;
        }
        else if (parentHwnd != IntPtr.Zero && entry.ParentHwnd != parentHwnd)
        {
            entry.ParentHwnd = parentHwnd;
            SetParent(entry.HostHwnd, parentHwnd);
        }

        entry.X = x;
        entry.Y = y;
        entry.Width = Math.Max(1, width);
        entry.Height = Math.Max(1, height);
        entry.Visible = visible;

        StripFrameStyles(childHwnd);
        if (GetParent(childHwnd) != entry.HostHwnd)
        {
            SetParent(childHwnd, entry.HostHwnd);
        }

        int l, t, r, b;
        if (MeasureChromeInsets(childHwnd, out l, out t, out r, out b))
        {
            entry.LeftInset = l;
            entry.TopInset = t;
            entry.RightInset = r;
            entry.BottomInset = b;
            entry.InsetsMeasured = true;
        }
        else if (!entry.InsetsMeasured && GetWindowClass(childHwnd) == "Chrome_WidgetWin_1")
        {
            double s = GetDpiScale(parentHwnd != IntPtr.Zero ? parentHwnd : childHwnd);
            entry.LeftInset = (int)Math.Round(6.5 * s);
            entry.TopInset = (int)Math.Round(28.5 * s);
            entry.RightInset = (int)Math.Round(6.0 * s);
            entry.BottomInset = (int)Math.Round(6.5 * s);
        }

        ApplyEntryLayout(entry, true);
        return entry;
    }

    private static void ApplyEntryLayout(EmbeddedEntry entry, bool frameChanged)
    {
        if (entry == null || !IsWindow(entry.ChildHwnd) || !IsWindow(entry.HostHwnd)) return;

        uint hostFlags = SWP_NOACTIVATE | (entry.Visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
        if (frameChanged) hostFlags |= SWP_FRAMECHANGED;
        SetWindowPos(
            entry.HostHwnd,
            HWND_TOP,
            entry.X,
            entry.Y,
            Math.Max(1, entry.Width),
            Math.Max(1, entry.Height),
            hostFlags);

        int childX = -entry.LeftInset;
        int childY = -entry.TopInset;
        int childW = Math.Max(1, entry.Width + entry.LeftInset + entry.RightInset);
        int childH = Math.Max(1, entry.Height + entry.TopInset + entry.BottomInset);
        uint childFlags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS | (entry.Visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
        if (frameChanged) childFlags |= SWP_FRAMECHANGED;
        SetWindowPos(entry.ChildHwnd, IntPtr.Zero, childX, childY, childW, childH, childFlags);
    }

    private static void RemoveEntry(long key, bool closeChild)
    {
        EmbeddedEntry entry;
        if (!Entries.TryGetValue(key, out entry)) return;
        Entries.Remove(key);
        if (closeChild && IsWindow(entry.ChildHwnd))
        {
            PostMessage(entry.ChildHwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        }
        try
        {
            if (entry.HostForm != null && !entry.HostForm.IsDisposed)
            {
                entry.HostForm.Dispose();
            }
        }
        catch
        {
        }
    }

    private static void WatchdogTick(object sender, EventArgs e)
    {
        if (Entries.Count == 0) return;
        List<long> keys = new List<long>(Entries.Keys);
        for (int i = 0; i < keys.Count; i++)
        {
            long key = keys[i];
            EmbeddedEntry entry;
            if (!Entries.TryGetValue(key, out entry)) continue;
            if (!IsWindow(entry.ChildHwnd) || (entry.ParentHwnd != IntPtr.Zero && !IsWindow(entry.ParentHwnd)))
            {
                string childDec = HandleToString(entry.ChildHwnd);
                RemoveEntry(key, false);
                WriteJsonLine(string.Format("{{\"event\":\"closed\",\"child\":\"{0}\"}}", JsonEscape(childDec)));
                continue;
            }

            bool needLayout = false;
            bool frameChanged = false;
            if (GetParent(entry.ChildHwnd) != entry.HostHwnd)
            {
                StripFrameStyles(entry.ChildHwnd);
                SetParent(entry.ChildHwnd, entry.HostHwnd);
                needLayout = true;
                frameChanged = true;
            }

            int l, t, r, b;
            if (MeasureChromeInsets(entry.ChildHwnd, out l, out t, out r, out b))
            {
                if (!entry.InsetsMeasured || l != entry.LeftInset || t != entry.TopInset || r != entry.RightInset || b != entry.BottomInset)
                {
                    entry.LeftInset = l;
                    entry.TopInset = t;
                    entry.RightInset = r;
                    entry.BottomInset = b;
                    entry.InsetsMeasured = true;
                    needLayout = true;
                }
            }

            RECT childRect;
            RECT hostRect;
            if (entry.Visible && GetWindowRect(entry.ChildHwnd, out childRect) && GetWindowRect(entry.HostHwnd, out hostRect))
            {
                int expectedLeft = hostRect.Left - entry.LeftInset;
                int expectedTop = hostRect.Top - entry.TopInset;
                int expectedW = entry.Width + entry.LeftInset + entry.RightInset;
                int expectedH = entry.Height + entry.TopInset + entry.BottomInset;
                int actualW = childRect.Right - childRect.Left;
                int actualH = childRect.Bottom - childRect.Top;
                if (Math.Abs(childRect.Left - expectedLeft) > 1 ||
                    Math.Abs(childRect.Top - expectedTop) > 1 ||
                    Math.Abs(actualW - expectedW) > 1 ||
                    Math.Abs(actualH - expectedH) > 1)
                {
                    needLayout = true;
                }
            }

            if (needLayout)
            {
                ApplyEntryLayout(entry, frameChanged);
            }
        }
    }

    private static string JsonEscape(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        StringBuilder sb = new StringBuilder(s.Length + 8);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '\\') sb.Append("\\\\");
            else if (c == '"') sb.Append("\\\"");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\t') sb.Append("\\t");
            else sb.Append(c);
        }
        return sb.ToString();
    }

    private static void WriteJsonLine(string line)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    private static Dictionary<string, string> ParseFlatJson(string line)
    {
        Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrEmpty(line)) return map;
        int i = 0;
        int len = line.Length;
        while (i < len)
        {
            if (line[i] == '"')
            {
                string key = ReadJsonString(line, ref i);
                while (i < len && char.IsWhiteSpace(line[i])) i++;
                if (i < len && line[i] == ':')
                {
                    i++;
                    while (i < len && char.IsWhiteSpace(line[i])) i++;
                    if (i < len)
                    {
                        if (line[i] == '"')
                        {
                            map[key] = ReadJsonString(line, ref i);
                        }
                        else
                        {
                            int start = i;
                            while (i < len && line[i] != ',' && line[i] != '}' && !char.IsWhiteSpace(line[i])) i++;
                            map[key] = line.Substring(start, i - start);
                        }
                    }
                }
            }
            else
            {
                i++;
            }
        }
        return map;
    }

    private static string ReadJsonString(string s, ref int idx)
    {
        StringBuilder sb = new StringBuilder();
        idx++; // skip opening "
        while (idx < s.Length)
        {
            char c = s[idx++];
            if (c == '\\' && idx < s.Length)
            {
                char esc = s[idx++];
                if (esc == 'n') sb.Append('\n');
                else if (esc == 'r') sb.Append('\r');
                else if (esc == 't') sb.Append('\t');
                else sb.Append(esc);
            }
            else if (c == '"')
            {
                break;
            }
            else
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }

    private static int GetInt(Dictionary<string, string> map, string key, int fallback)
    {
        string val;
        int parsed;
        if (map.TryGetValue(key, out val) && int.TryParse(val, out parsed)) return parsed;
        return fallback;
    }

    private static bool GetBool(Dictionary<string, string> map, string key, bool fallback)
    {
        string val;
        if (!map.TryGetValue(key, out val)) return fallback;
        if (string.Equals(val, "true", StringComparison.OrdinalIgnoreCase) || val == "1") return true;
        if (string.Equals(val, "false", StringComparison.OrdinalIgnoreCase) || val == "0") return false;
        return fallback;
    }

    private static string HandleServeCommand(Dictionary<string, string> msg)
    {
        string id = msg.ContainsKey("id") ? msg["id"] : "";
        string cmd = msg.ContainsKey("cmd") ? msg["cmd"] : "";

        try
        {
            if (cmd == "list-chrome")
            {
                List<string> items = ListChromeWindows();
                StringBuilder arr = new StringBuilder("[");
                for (int i = 0; i < items.Count; i++)
                {
                    if (i > 0) arr.Append(",");
                    arr.Append("\"").Append(JsonEscape(items[i])).Append("\"");
                }
                arr.Append("]");
                return string.Format("{{\"id\":\"{0}\",\"ok\":true,\"handles\":{1}}}", JsonEscape(id), arr.ToString());
            }

            if (cmd == "is-window")
            {
                IntPtr child = ParseHandle(msg.ContainsKey("child") ? msg["child"] : "");
                bool alive = child != IntPtr.Zero && IsWindow(child);
                return string.Format("{{\"id\":\"{0}\",\"ok\":true,\"alive\":{1}}}", JsonEscape(id), alive ? "true" : "false");
            }

            if (cmd == "attach")
            {
                IntPtr parent = ParseHandle(msg.ContainsKey("parent") ? msg["parent"] : "");
                IntPtr child = ParseHandle(msg.ContainsKey("child") ? msg["child"] : "");
                int x = GetInt(msg, "x", 0);
                int y = GetInt(msg, "y", 0);
                int w = GetInt(msg, "w", 1);
                int h = GetInt(msg, "h", 1);
                bool visible = GetBool(msg, "visible", true);
                if (parent == IntPtr.Zero || child == IntPtr.Zero || !IsWindow(parent) || !IsWindow(child))
                {
                    return string.Format("{{\"id\":\"{0}\",\"ok\":false,\"error\":\"invalid_handle\"}}", JsonEscape(id));
                }
                EmbeddedEntry entry = CreateOrUpdateHost(parent, child, x, y, w, h, visible);
                return string.Format(
                    "{{\"id\":\"{0}\",\"ok\":true,\"host\":\"{1}\",\"insets\":{{\"left\":{2},\"top\":{3},\"right\":{4},\"bottom\":{5}}}}}",
                    JsonEscape(id),
                    JsonEscape(HandleToString(entry.HostHwnd)),
                    entry.LeftInset,
                    entry.TopInset,
                    entry.RightInset,
                    entry.BottomInset);
            }

            if (cmd == "bounds")
            {
                IntPtr child = ParseHandle(msg.ContainsKey("child") ? msg["child"] : "");
                int x = GetInt(msg, "x", 0);
                int y = GetInt(msg, "y", 0);
                int w = GetInt(msg, "w", 1);
                int h = GetInt(msg, "h", 1);
                bool visible = GetBool(msg, "visible", true);
                if (child == IntPtr.Zero || !IsWindow(child))
                {
                    return string.Format("{{\"id\":\"{0}\",\"ok\":false,\"error\":\"invalid_child\"}}", JsonEscape(id));
                }
                EmbeddedEntry entry;
                if (Entries.TryGetValue(child.ToInt64(), out entry))
                {
                    entry.X = x;
                    entry.Y = y;
                    entry.Width = Math.Max(1, w);
                    entry.Height = Math.Max(1, h);
                    entry.Visible = visible;
                    int l, t, r, b;
                    if (MeasureChromeInsets(child, out l, out t, out r, out b))
                    {
                        entry.LeftInset = l;
                        entry.TopInset = t;
                        entry.RightInset = r;
                        entry.BottomInset = b;
                        entry.InsetsMeasured = true;
                    }
                    ApplyEntryLayout(entry, false);
                    return string.Format("{{\"id\":\"{0}\",\"ok\":true}}", JsonEscape(id));
                }
                SetWindowPos(
                    child,
                    HWND_TOP,
                    x,
                    y,
                    Math.Max(1, w),
                    Math.Max(1, h),
                    SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
                return string.Format("{{\"id\":\"{0}\",\"ok\":true}}", JsonEscape(id));
            }

            if (cmd == "focus")
            {
                IntPtr child = ParseHandle(msg.ContainsKey("child") ? msg["child"] : "");
                EmbeddedEntry entry;
                if (child != IntPtr.Zero && Entries.TryGetValue(child.ToInt64(), out entry) && IsWindow(entry.HostHwnd))
                {
                    SetWindowPos(entry.HostHwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | (entry.Visible ? SWP_SHOWWINDOW : 0));
                    IntPtr fg = GetForegroundWindow();
                    if (entry.ParentHwnd != IntPtr.Zero && (fg == entry.ParentHwnd || IsChild(entry.ParentHwnd, fg)))
                    {
                        PostMessage(entry.ChildHwnd, WM_ACTIVATE, new IntPtr(1), IntPtr.Zero);
                    }
                    return string.Format("{{\"id\":\"{0}\",\"ok\":true}}", JsonEscape(id));
                }
                return string.Format("{{\"id\":\"{0}\",\"ok\":false,\"error\":\"not_attached\"}}", JsonEscape(id));
            }

            if (cmd == "close")
            {
                IntPtr child = ParseHandle(msg.ContainsKey("child") ? msg["child"] : "");
                if (child != IntPtr.Zero)
                {
                    if (Entries.ContainsKey(child.ToInt64()))
                    {
                        RemoveEntry(child.ToInt64(), true);
                    }
                    else if (IsWindow(child))
                    {
                        PostMessage(child, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    }
                }
                return string.Format("{{\"id\":\"{0}\",\"ok\":true}}", JsonEscape(id));
            }

            return string.Format("{{\"id\":\"{0}\",\"ok\":false,\"error\":\"unknown_cmd\"}}", JsonEscape(id));
        }
        catch (Exception ex)
        {
            return string.Format("{{\"id\":\"{0}\",\"ok\":false,\"error\":\"{1}\"}}", JsonEscape(id), JsonEscape(ex.Message));
        }
    }

    private static void ShutdownAllEntries()
    {
        List<long> keys = new List<long>(Entries.Keys);
        for (int i = 0; i < keys.Count; i++)
        {
            RemoveEntry(keys[i], true);
        }
    }

    private static int RunServe()
    {
        UiMarshaller = new Control();
        UiMarshaller.CreateControl();

        WatchdogTimer = new System.Windows.Forms.Timer();
        WatchdogTimer.Interval = 150;
        WatchdogTimer.Tick += WatchdogTick;
        WatchdogTimer.Start();

        Thread reader = new Thread(delegate()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    string captured = line;
                    try
                    {
                        UiMarshaller.BeginInvoke((MethodInvoker)delegate
                        {
                            Dictionary<string, string> msg = ParseFlatJson(captured);
                            string resp = HandleServeCommand(msg);
                            WriteJsonLine(resp);
                        });
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }
            finally
            {
                try
                {
                    UiMarshaller.BeginInvoke((MethodInvoker)delegate
                    {
                        if (WatchdogTimer != null) WatchdogTimer.Stop();
                        ShutdownAllEntries();
                        Application.ExitThread();
                    });
                }
                catch
                {
                    Environment.Exit(0);
                }
            }
        });
        reader.IsBackground = true;
        reader.Start();

        WriteJsonLine("{\"event\":\"ready\"}");
        Application.Run();
        return 0;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        EnableDpiAwareness();
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);

        if (args.Length == 0) return 1;
        string cmd = args[0];

        if (cmd == "serve")
        {
            return RunServe();
        }

        if (cmd == "list-chrome")
        {
            List<string> handles = ListChromeWindows();
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < handles.Count; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append("\"").Append(handles[i]).Append("\"");
            }
            sb.Append("]");
            Console.WriteLine(sb.ToString());
            return 0;
        }

        if (cmd == "is-window" && args.Length >= 2)
        {
            IntPtr h = ParseHandle(args[1]);
            bool alive = h != IntPtr.Zero && IsWindow(h);
            Console.WriteLine(alive ? "1" : "0");
            return 0;
        }

        if (cmd == "close" && args.Length >= 2)
        {
            IntPtr h = ParseHandle(args[1]);
            if (h != IntPtr.Zero && IsWindow(h))
            {
                PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            }
            return 0;
        }

        if (cmd == "attach" && args.Length >= 8)
        {
            IntPtr parent = ParseHandle(args[1]);
            IntPtr child = ParseHandle(args[2]);
            int x, y, w, h;
            if (!int.TryParse(args[3], out x) || !int.TryParse(args[4], out y) || !int.TryParse(args[5], out w) || !int.TryParse(args[6], out h))
            {
                return 2;
            }
            bool visible = args[7] == "1";
            if (parent == IntPtr.Zero || child == IntPtr.Zero || !IsWindow(parent) || !IsWindow(child)) return 3;
            StripFrameStyles(child);
            SetParent(child, parent);
            int l, t, r, b;
            MeasureChromeInsets(child, out l, out t, out r, out b);
            SetWindowPos(
                child,
                HWND_TOP,
                x - l,
                y - t,
                Math.Max(1, w + l + r),
                Math.Max(1, h + t + b),
                SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
            return 0;
        }

        if (cmd == "bounds" && args.Length >= 7)
        {
            IntPtr child = ParseHandle(args[1]);
            int x, y, w, h;
            if (!int.TryParse(args[2], out x) || !int.TryParse(args[3], out y) || !int.TryParse(args[4], out w) || !int.TryParse(args[5], out h))
            {
                return 2;
            }
            bool visible = args[6] == "1";
            if (child == IntPtr.Zero || !IsWindow(child)) return 3;
            int l, t, r, b;
            MeasureChromeInsets(child, out l, out t, out r, out b);
            SetWindowPos(
                child,
                HWND_TOP,
                x - l,
                y - t,
                Math.Max(1, w + l + r),
                Math.Max(1, h + t + b),
                SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
            return 0;
        }

        return 1;
    }
}
