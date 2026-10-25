//! List prices in USD per million tokens. Used only when Claude Code's own
//! status line cost is unavailable; the UI labels the result as an estimate.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub context: u64,
}

const fn p(input: f64, output: f64, cache_read: f64, context: u64) -> Price {
    Price {
        input,
        output,
        cache_read,
        context,
    }
}

/// Longest prefix wins, so `claude-opus-4-8` beats `claude-opus-4`.
const TABLE: &[(&str, Price)] = &[
    ("claude-fable-5-1", p(10.0, 50.0, 0.25, 1_000_000)),
    ("claude-fable-5", p(10.0, 50.0, 1.0, 1_000_000)),
    ("claude-mythos-5", p(10.0, 50.0, 1.0, 1_000_000)),
    ("claude-opus-5-5", p(4.0, 20.0, 0.20, 1_000_000)),
    ("claude-opus-5", p(5.0, 25.0, 0.50, 1_000_000)),
    ("claude-opus-4-8", p(5.0, 25.0, 0.50, 1_000_000)),
    ("claude-opus-4-7", p(5.0, 25.0, 0.50, 1_000_000)),
    ("claude-opus-4-6", p(5.0, 25.0, 0.50, 1_000_000)),
    ("claude-opus-4", p(15.0, 75.0, 1.50, 200_000)),
    ("claude-sonnet-5-5", p(2.0, 10.0, 0.20, 1_000_000)),
    ("claude-sonnet-5", p(2.0, 10.0, 0.20, 1_000_000)),
    ("claude-sonnet-4-6", p(3.0, 15.0, 0.30, 1_000_000)),
    ("claude-sonnet-4", p(3.0, 15.0, 0.30, 200_000)),
    ("claude-haiku-5-5", p(0.10, 0.50, 0.01, 1_000_000)),
    ("claude-haiku-4-5", p(1.0, 5.0, 0.10, 200_000)),
    ("claude-3-5-haiku", p(0.80, 4.0, 0.08, 200_000)),
];

pub fn price(model: &str) -> Option<Price> {
    let m = model.trim_end_matches("[1m]");
    TABLE
        .iter()
        .filter(|(prefix, _)| m.starts_with(prefix))
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, p)| *p)
}

pub fn context_window(model: &str) -> u64 {
    if model.ends_with("[1m]") {
        return 1_000_000;
    }
    price(model).map_or(200_000, |p| p.context)
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
}

/// Cache writes cost 1.25× input (5 min) or 2× input (1 h).
pub fn cost(model: &str, t: &Tokens) -> f64 {
    let Some(p) = price(model) else { return 0.0 };
    let m = 1_000_000.0;
    (t.input as f64 * p.input
        + t.output as f64 * p.output
        + t.cache_read as f64 * p.cache_read
        + t.cache_write_5m as f64 * p.input * 1.25
        + t.cache_write_1h as f64 * p.input * 2.0)
        / m
}

/// `claude-opus-5-5` → `Opus 5.5`
pub fn display_name(model: &str) -> String {
    let m = model.trim_start_matches("claude-").trim_end_matches("[1m]");
    let mut parts = m.split('-');
    let family = parts.next().unwrap_or(m);
    let version: Vec<&str> = parts
        .take_while(|p| p.len() <= 2 && p.chars().all(|c| c.is_ascii_digit()))
        .collect();
    let mut name = family[..1].to_uppercase() + &family[1..];
    if !version.is_empty() {
        name.push(' ');
        name.push_str(&version.join("."));
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup() {
        assert_eq!(price("claude-opus-4-8").unwrap().input, 5.0);
        assert_eq!(price("claude-opus-4-1-20250805").unwrap().input, 15.0);
        assert_eq!(context_window("claude-haiku-4-5-20251001"), 200_000);
        assert_eq!(context_window("claude-sonnet-4-5[1m]"), 1_000_000);
        assert!(price("gpt-4").is_none());
    }

    #[test]
    fn costs() {
        let t = Tokens {
            input: 1_000_000,
            output: 100_000,
            cache_read: 1_000_000,
            cache_write_5m: 0,
            cache_write_1h: 100_000,
        };
        let c = cost("claude-opus-5-5", &t);
        assert!((c - (4.0 + 2.0 + 0.2 + 0.8)).abs() < 1e-9, "{c}");
    }

    #[test]
    fn names() {
        assert_eq!(display_name("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(display_name("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
        assert_eq!(display_name("claude-fable-5-1"), "Fable 5.1");
        assert_eq!(display_name("claude-haiku-4-5[1m]"), "Haiku 4.5");
    }
}
