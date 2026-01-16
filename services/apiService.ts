import axios from "axios";

const BASE_URL = "http://192.168.0.105";

export const testBackend = async () => {
  const response = await axios.get(`${BASE_URL}/test`);
  return response.data;
};
