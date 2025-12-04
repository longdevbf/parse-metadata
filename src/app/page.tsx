/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Copy, Info } from 'lucide-react';

interface Metadata {
  '0': string;
  '1': string;
  '10': string[];
  '99': string;
}

interface ParsedResult {
  catalystId: string;
  votingKeyHex: string;
  votingKeyBase64: string;
  stakeAddress: string;
  nonce: string;
  registrationId: string;
  paymentAddressHash: string;
  votingPower: any[];
  signature: string;
}

type CopiedLabel = 'catalyst' | 'hex' | 'base64' | 'stake' | '';

const CatalystMetadataParser: React.FC = () => {
  const [input, setInput] = useState<string>('');
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<CopiedLabel>('');

  // Helper functions
  const hexToBytes = (hex: string): Uint8Array => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) {
      bytes.push(parseInt(clean.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  };

  const bytesToHex = (bytes: Uint8Array): string => {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  };

  const base64UrlEncode = (bytes: Uint8Array): string => {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const decodeCBOR = (bytes: Uint8Array): any => {
    let pos = 0;
    
    const readByte = (): number => bytes[pos++];
    const readBytes = (n: number): Uint8Array => {
      const result = bytes.slice(pos, pos + n);
      pos += n;
      return result;
    };

    const decode = (): any => {
      const initialByte = readByte();
      const majorType = initialByte >> 5;
      const additionalInfo = initialByte & 0x1f;

      if (majorType === 5) { // Map
        const length = additionalInfo < 24 ? additionalInfo : 
                      additionalInfo === 24 ? readByte() : 
                      additionalInfo === 25 ? (readByte() << 8) | readByte() : 0;
        
        const map: Record<string | number, any> = {};
        for (let i = 0; i < length; i++) {
          const key = decode();
          const value = decode();
          map[key] = value;
        }
        return map;
      } else if (majorType === 4) { // Array
        const length = additionalInfo < 24 ? additionalInfo : 
                      additionalInfo === 24 ? readByte() : 0;
        
        const arr: any[] = [];
        for (let i = 0; i < length; i++) {
          arr.push(decode());
        }
        return arr;
      } else if (majorType === 0) { // Unsigned int
        if (additionalInfo < 24) return additionalInfo;
        if (additionalInfo === 24) return readByte();
        if (additionalInfo === 25) return (readByte() << 8) | readByte();
      } else if (majorType === 2) { // Byte string
        const length = additionalInfo < 24 ? additionalInfo : 
                      additionalInfo === 24 ? readByte() : 
                      additionalInfo === 25 ? (readByte() << 8) | readByte() : 0;
        return readBytes(length);
      } else if (majorType === 6) { // Tagged
        const tag = additionalInfo < 24 ? additionalInfo : 
                   additionalInfo === 24 ? readByte() : 0;
        const value = decode();
        return { tag, value };
      } else if (majorType === 7 && additionalInfo === 22) { // undefined
        return undefined;
      }
      
      return null;
    };

    try {
      return decode();
    } catch (e) {
      return null;
    }
  };

  const parseMetadata = (metadata: Metadata): ParsedResult => {
    try {
      // Ghép certificate chunks
      const certChunks = metadata['10'].map(chunk => hexToBytes(chunk));
      const fullCert = new Uint8Array(
        certChunks.reduce((acc, chunk) => acc + chunk.length, 0)
      );
      
      let offset = 0;
      certChunks.forEach(chunk => {
        fullCert.set(chunk, offset);
        offset += chunk.length;
      });

      // Tìm voting public key
      const marker = new Uint8Array([0x03, 0x21, 0x00]);
      let markerIndex = -1;
      
      for (let i = 0; i < fullCert.length - 3; i++) {
        if (fullCert[i] === marker[0] && 
            fullCert[i + 1] === marker[1] && 
            fullCert[i + 2] === marker[2]) {
          markerIndex = i;
          break;
        }
      }

      if (markerIndex === -1) {
        throw new Error('Could not find voting public key in certificate');
      }

      const votingKeyBytes = fullCert.slice(markerIndex + 3, markerIndex + 35);
      const votingKeyHex = bytesToHex(votingKeyBytes);
      const votingKeyBase64 = base64UrlEncode(votingKeyBytes);
      const catalystId = `id.catalyst://cardano/${votingKeyBase64}`;

      // Extract stake address
      const certStr = new TextDecoder('utf-8', { fatal: false }).decode(fullCert);
      const stakeMatch = certStr.match(/stake1[a-z0-9]{53,59}/);
      const stakeAddress = stakeMatch ? stakeMatch[0] : 'N/A';

      // Parse CBOR data
      const decoded = decodeCBOR(fullCert);
      let paymentAddressHash = 'N/A';
      let votingPower: any[] = [];

      if (decoded && decoded[30] && decoded[30][2]) {
        const paymentData = decoded[30][2];
        if (paymentData && paymentData.value) {
          paymentAddressHash = bytesToHex(paymentData.value);
        }
      }

      if (decoded && decoded[100]) {
        votingPower = decoded[100];
      }

      return {
        catalystId,
        votingKeyHex,
        votingKeyBase64,
        stakeAddress,
        nonce: metadata['0'].slice(2),
        registrationId: metadata['1'].slice(2),
        paymentAddressHash,
        votingPower,
        signature: metadata['99'].slice(2)
      };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      throw new Error(`Parse error: ${errorMessage}`);
    }
  };

  const handleParse = (): void => {
    setError('');
    setResult(null);

    try {
      const metadata = JSON.parse(input) as Metadata;
      
      if (!metadata['0'] || !metadata['1'] || !metadata['10'] || !metadata['99']) {
        throw new Error('Invalid metadata format. Missing required keys: 0, 1, 10, 99');
      }

      const parsed = parseMetadata(metadata);
      setResult(parsed);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      setError(errorMessage);
    }
  };

  const copyToClipboard = (text: string, label: CopiedLabel): void => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
            <h1 className="text-3xl font-bold mb-2">🎯 Catalyst Metadata Parser</h1>
            <p className="text-blue-100">Parse Cardano Project Catalyst voting registration metadata</p>
          </div>

          {/* Input Section */}
          <div className="p-6 border-b">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Paste Metadata JSON
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='{"0":"0xca7a1457...","1":"0x717c1554...","10":[...],"99":"0xdd180f13..."}'
              className="w-full h-40 p-4 border-2 border-gray-200 rounded-lg font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
            <button
              onClick={handleParse}
              className="mt-4 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
            >
              Parse Metadata
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mx-6 mt-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start gap-3">
              <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-semibold text-red-800">Error</p>
                <p className="text-red-700 text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Result Display */}
          {result && (
            <div className="p-6 space-y-6">
              {/* Success Banner */}
              <div className="p-4 bg-green-50 border-l-4 border-green-500 rounded-lg flex items-start gap-3">
                <CheckCircle className="text-green-500 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="font-semibold text-green-800">✅ Registration Valid</p>
                  <p className="text-green-700 text-sm mt-1">Ready to vote in Catalyst!</p>
                </div>
              </div>

              {/* Catalyst ID - Most Important */}
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-6 rounded-xl border-2 border-purple-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-purple-900 flex items-center gap-2">
                    🆔 Catalyst ID
                    <span className="text-xs font-normal bg-purple-200 text-purple-800 px-2 py-1 rounded">Most Important</span>
                  </h3>
                  <button
                    onClick={() => copyToClipboard(result.catalystId, 'catalyst')}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all flex items-center gap-2 text-sm"
                  >
                    <Copy size={14} />
                    {copied === 'catalyst' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="font-mono text-sm bg-white p-3 rounded border border-purple-200 break-all">
                  {result.catalystId}
                </p>
                <div className="mt-3 flex items-start gap-2 text-xs text-purple-700">
                  <Info size={14} className="flex-shrink-0 mt-0.5" />
                  <span>Use this ID in the Catalyst Voting App to cast your votes</span>
                </div>
              </div>

              {/* Voting Public Key */}
              <div className="bg-gray-50 p-5 rounded-xl">
                <h3 className="text-md font-bold text-gray-800 mb-3">🔑 Voting Public Key</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">Hex Format</label>
                    <div className="flex gap-2">
                      <p className="flex-1 font-mono text-xs bg-white p-3 rounded border break-all">
                        {result.votingKeyHex}
                      </p>
                      <button
                        onClick={() => copyToClipboard(result.votingKeyHex, 'hex')}
                        className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-all"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">Base64 Format</label>
                    <div className="flex gap-2">
                      <p className="flex-1 font-mono text-xs bg-white p-3 rounded border break-all">
                        {result.votingKeyBase64}
                      </p>
                      <button
                        onClick={() => copyToClipboard(result.votingKeyBase64, 'base64')}
                        className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-all"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stake Address */}
              <div className="bg-gray-50 p-5 rounded-xl">
                <h3 className="text-md font-bold text-gray-800 mb-3">📍 Stake Address</h3>
                <div className="flex gap-2">
                  <p className="flex-1 font-mono text-xs bg-white p-3 rounded border break-all">
                    {result.stakeAddress}
                  </p>
                  <button
                    onClick={() => copyToClipboard(result.stakeAddress, 'stake')}
                    className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-all"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              {/* Registration IDs */}
              <div className="bg-gray-50 p-5 rounded-xl">
                <h3 className="text-md font-bold text-gray-800 mb-3">🎲 Registration IDs</h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Nonce</label>
                    <p className="font-mono text-xs bg-white p-2 rounded border mt-1 break-all">
                      {result.nonce}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Registration ID</label>
                    <p className="font-mono text-xs bg-white p-2 rounded border mt-1 break-all">
                      {result.registrationId}
                    </p>
                  </div>
                </div>
              </div>

              {/* Payment Address Hash */}
              <div className="bg-gray-50 p-5 rounded-xl">
                <h3 className="text-md font-bold text-gray-800 mb-3">💰 Payment Address Hash</h3>
                <p className="font-mono text-xs bg-white p-3 rounded border break-all">
                  {result.paymentAddressHash}
                </p>
              </div>

              {/* Voting Power Distribution */}
              {result.votingPower && result.votingPower.length > 0 && (
                <div className="bg-gray-50 p-5 rounded-xl">
                  <h3 className="text-md font-bold text-gray-800 mb-3">📊 Voting Power Distribution</h3>
                  <div className="space-y-2">
                    {result.votingPower.map((delegation: any, i: number) => (
                      <div key={i} className="bg-white p-3 rounded border text-sm">
                        <span className="font-semibold text-gray-700">[{i}]</span>
                        <span className="ml-3 text-gray-600">
                          Weight: {JSON.stringify(delegation[1])}, Purpose: {delegation[3]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Signature */}
              <div className="bg-gray-50 p-5 rounded-xl">
                <h3 className="text-md font-bold text-gray-800 mb-3">✍️ Signature</h3>
                <p className="font-mono text-xs bg-white p-3 rounded border break-all">
                  {result.signature.substring(0, 80)}...
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="bg-gray-50 p-4 text-center text-xs text-gray-500 border-t">
            Project Catalyst Metadata Parser • Developed by Thomas Long
          </div>
        </div>
      </div>
    </div>
  );
};

export default CatalystMetadataParser;