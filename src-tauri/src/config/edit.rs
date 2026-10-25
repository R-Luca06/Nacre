//! Comment-preserving edits of config.toml, used by the settings UI.

use serde_json::Value;
use toml_edit::{Array, DocumentMut, InlineTable, Item, Table, value};

fn to_value(v: &Value) -> Option<toml_edit::Value> {
    Some(match v {
        Value::Bool(b) => (*b).into(),
        Value::Number(n) => match n.as_i64() {
            Some(i) => i.into(),
            None => n.as_f64()?.into(),
        },
        Value::String(s) => s.as_str().into(),
        Value::Array(items) => {
            let mut a = Array::new();
            for i in items {
                a.push(to_value(i)?);
            }
            toml_edit::Value::Array(a)
        }
        Value::Object(map) => {
            let mut t = InlineTable::new();
            for (k, v) in map {
                t.insert(k, to_value(v)?);
            }
            toml_edit::Value::InlineTable(t)
        }
        Value::Null => return None,
    })
}

/// Sets `path` (e.g. `["font", "size"]`) to `v`; `null` removes the key.
pub fn set(text: &str, path: &[String], v: &Value) -> Result<String, String> {
    let mut doc: DocumentMut = text
        .parse()
        .map_err(|e: toml_edit::TomlError| e.to_string())?;
    let (last, parents) = path.split_last().ok_or("empty path")?;
    let mut table: &mut Table = doc.as_table_mut();
    for key in parents {
        if !table.contains_key(key) {
            let mut t = Table::new();
            t.set_implicit(false);
            table.insert(key, Item::Table(t));
        }
        table = table[key.as_str()]
            .as_table_mut()
            .ok_or_else(|| format!("{key} is not a table"))?;
    }
    match to_value(v) {
        None => {
            table.remove(last);
        }
        Some(val) => {
            // Keep decor (comments) of an existing key.
            if let Some(Item::Value(existing)) = table.get_mut(last) {
                let decor = existing.decor().clone();
                *existing = val;
                *existing.decor_mut() = decor;
            } else {
                table[last.as_str()] = value(val);
            }
        }
    }
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn p(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn keeps_comments() {
        let src = "# top\n[font]\n# the size\nsize = 13 # inline\n";
        let out = set(src, &p(&["font", "size"]), &json!(15)).unwrap();
        assert!(out.contains("# top"));
        assert!(out.contains("# the size"));
        assert!(out.contains("size = 15 # inline"), "{out}");
    }

    #[test]
    fn creates_tables_and_removes() {
        let out = set("", &p(&["keys", "tab.new"]), &json!(["cmd+t", "ctrl+t"])).unwrap();
        assert!(out.contains("[keys]"));
        assert!(out.contains(r#""tab.new" = ["cmd+t", "ctrl+t"]"#), "{out}");
        let out = set(&out, &p(&["keys", "tab.new"]), &Value::Null).unwrap();
        assert!(!out.contains("tab.new"));
    }
}
