import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "node_modules/**", ".claude/**"] }];

export default config;
