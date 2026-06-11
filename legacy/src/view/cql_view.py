import streamlit as st
import pandas as pd
import streamlit.components.v1 as components
from streamlit_monaco import st_monaco

_KEYBOARD_SHORTCUT_JS = """
<script>
(function() {
    function attachShortcut(doc, parentDoc) {
        if (!doc || doc._cqlShortcutAttached) return;
        doc._cqlShortcutAttached = true;
        doc.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                var buttons = parentDoc.querySelectorAll('button');
                for (var i = 0; i < buttons.length; i++) {
                    if (buttons[i].textContent.trim() === 'Execute Query') {
                        buttons[i].click();
                        return;
                    }
                }
            }
        });
    }

    function setup() {
        var par = window.parent;
        if (!par) return;
        attachShortcut(par.document, par.document);
        function attachToIframes() {
            var iframes = par.document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                try { attachShortcut(iframes[i].contentDocument, par.document); } catch(e) {}
            }
        }
        attachToIframes();
        var observer = new par.MutationObserver(attachToIframes);
        observer.observe(par.document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }
})();
</script>
"""

def render(execute_callback):
    """
    Renders the CQL Editor component in an expandable section.

    Args:
        execute_callback: Function to execute CQL queries.
    """
    with st.expander("CQL Editor", expanded=False):
        st.caption("Execute custom CQL queries against the connected cluster.")
        components.html(_KEYBOARD_SHORTCUT_JS, height=0)
        query = st_monaco(value="", language="sql", theme="vs-light")

        if st.button("Execute Query", key="cql_editor_btn"):
            if not query.strip():
                st.warning("Please enter a query.")
                return

            # noinspection PyTypeChecker
            with st.spinner("Executing..."):
                result = execute_callback(query)
            
            if result.success:
                st.success("Query executed successfully")
                if result.data:
                    # Convert to DataFrame for better display
                    st.dataframe(pd.DataFrame(result.data), use_container_width=True)
                else:
                    st.info("No rows returned.")
            else:
                st.error(f"Error: {result.message}")