import Homey from 'homey';
import fetch from 'node-fetch';


/**
 * Represents an authentication error.
 * @class
 * @extends Error
 */
export class AuthError extends Error {
    constructor(message : string) {
        super(message);
        this.name = 'AuthError';
    }
}

const BASE_URL = "https://api.ocp.electrolux.one/";
const TOKEN_URL = BASE_URL + "one-account-authorization/api/v1/token";
const AUTHENTICATION_URL = BASE_URL + "one-account-authentication/api/v1/authenticate";
const API_URL = BASE_URL + "appliance/api/v2/appliances";
const CLIENT_ID = Homey.env.CLIENT_ID;
const CLIENT_SECRET = Homey.env.CLIENT_SECRET
const X_API_KEY = Homey.env.X_API_KEY;

export class ElectroluxApi {
    log: (message: string) => void;
    auth_state = {
        accessToken: "",
        idToken: "",
        exchangeToken: "",
        expiresAt: null as Date|null,
        username: "",
        password: "",
        countryCode: "",
        failTime: null as number|null
    }
    constructor(log: (message: string) => void) {
        this.log = log;
    }

    async getAccessToken() {
        const tokenResponse = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
                grantType: "client_credentials"
            })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.accessToken) {
            throw new AuthError("Error obtaining client token");
        }

        this.auth_state.accessToken = tokenData.accessToken;
    }

    async authenticateUser() {
        await this.getAccessToken();
        const loginResponse = await fetch(AUTHENTICATION_URL, {
            method: "POST",
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.auth_state.accessToken}`,
                'x-api-key': X_API_KEY
            },
            body: JSON.stringify({
                username: this.auth_state.username,
                password: this.auth_state.password
            })
        });

        const loginData = await loginResponse.json();
        if (!loginData.idToken) {
            throw new AuthError("Error obtaining user idToken");
        }

        this.auth_state.idToken = loginData.idToken;
        this.auth_state.countryCode = loginData.countryCode;
    }

    async exchangeToken() {
        await this.authenticateUser();
        const tokenExchangeResponse = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { 
                'Content-Type': 'application/json',
                'Origin-Country-Code': this.auth_state.countryCode
            },
            body: JSON.stringify({
                clientId: CLIENT_ID,
                idToken: this.auth_state.idToken,
                grantType: "urn:ietf:params:oauth:grant-type:token-exchange"
            })
        });

        const exchangeData = await tokenExchangeResponse.json();
        if (!exchangeData.accessToken) {
            throw new AuthError("Error exchanging token");
        }

        
        this.auth_state.exchangeToken = exchangeData.accessToken;
        this.auth_state.expiresAt = new Date(new Date().getTime() + exchangeData.expiresIn * 1000);
    }

    handleError(error : Error) {
        this.auth_state.failTime = Date.now();
        throw error;
    }
    
    async fetchApi(suffix : string, method = 'GET', body? : string) {    
        if (!this.auth_state.exchangeToken || !this.auth_state.expiresAt || new Date() >= this.auth_state.expiresAt) {
            await this.exchangeToken();
        }
        
        this.log(`fetchApi(${suffix}, ${method}, ${body})`);


        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.auth_state.exchangeToken}`,
                'x-api-key': X_API_KEY
            },
            body : undefined as string|undefined
        };
        
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        try {
            const response = await fetch(API_URL + suffix, options);
            const responseBody = await response.text();

            if (!response.ok) {
                this.log(`API request to ${suffix} failed with status: ${response.status}`);
                this.log(`API response body: ${responseBody}`);
                this.handleError(new Error(`API request failed: ${response.status} ${response.statusText}`));
                return;
            }
        
            return responseBody ? JSON.parse(responseBody) : null;

            } catch (error) {
                this.log(`Error in fetchApi: ${error}`);
                this.handleError(error as Error);
            }
    }

    setAuth(username : string, password : string) {
        this.auth_state.username = username;
        this.auth_state.password = password;
    }    
   
    async getAppliances() : Promise<any> {
        try {
            return await this.fetchApi('/', 'GET');
        } catch (error) {
            this.log(`Error fetching appliances: ${error}`);
            throw error; // Re-throw error for further handling
        }
    }

    async getAppliance(pncId : string) {
        try {
            if (!pncId) {
                throw new Error("Missing device ID");
            }
            return await this.fetchApi(`/${pncId}`, 'GET');
        } catch (error) {
            this.log(`Error fetching appliance with ID ${pncId}: ${error}`);
            throw error; // Re-throw error for further handling
        }
    }

    async sendDeviceCommand(deviceId : string, command : any) {
        const suffix = `/${deviceId}/command`;   
        try {
            await this.fetchApi(`${suffix}`, 'PUT', command);
        } catch (error) {
            this.log(`Error sending command to device ID: ${deviceId}: ${error}`);
        }
    }
}
