const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    "https://gcppuiinijqyanhmundu.supabase.co",
    "sb_publishable_EjT9RsIfXbADamKQTj1gKw_BKrZCZ3C"
);

module.exports = supabase;