# Requirements Document

## Introduction

This feature adds NFC-e (Nota Fiscal de Consumidor Eletrônica) text paste-and-parse capability to the manual approval flow in the TableCupomFiscal component. Reviewers will be able to copy the NFC-e text from state tax authority websites, select the originating Brazilian state (UF), paste the text into a designated area, and have the system automatically parse and fill the approval form fields. Each Brazilian state formats NFC-e text differently, so the system uses modular, per-state parsers.

## Glossary

- **NFC-e**: Nota Fiscal de Consumidor Eletrônica — an electronic consumer receipt issued by Brazilian establishments
- **UF**: Unidade Federativa — a Brazilian state code (e.g., MG, PE, SP)
- **Parser**: A module that extracts structured data from raw NFC-e text for a specific UF format
- **Approval_Form**: The modal form in the TableCupomFiscal component where reviewers fill in CNPJ, establishment name, issued date/time, and line items before approving a receipt
- **Paste_Area**: A textarea UI element within the Approval_Form where users paste raw NFC-e text
- **State_Selector**: A dropdown UI element within the Approval_Form where users select which Brazilian state (UF) the NFC-e originates from
- **Parsed_Result**: A structured object containing CNPJ, establishment name, issued date, issued time, line items (description, quantity, unit value, total item value), and total amount extracted from raw NFC-e text
- **Line_Item**: A single product entry containing description, quantity, unit value, and total item value

## Requirements

### Requirement 1: Paste Area in Approval Modal

**User Story:** As a reviewer, I want a text paste area in the approval modal, so that I can paste raw NFC-e text copied from state tax authority websites.

#### Acceptance Criteria

1. WHEN the Approval_Form is opened, THE Approval_Form SHALL display a Paste_Area textarea element with a minimum visible height of 4 text rows, positioned above the manual input fields, in an empty state with no pre-filled content
2. WHEN text is pasted or typed into the Paste_Area, THE Approval_Form SHALL display the text in the Paste_Area preserving all original whitespace, line breaks, and special characters, and retain it in state until the form is closed or submitted
3. THE Paste_Area SHALL accept text input via clipboard paste (Ctrl+V / Cmd+V) and via manual typing, up to a maximum of 50,000 characters

### Requirement 2: State Selector

**User Story:** As a reviewer, I want to select the Brazilian state (UF) of the NFC-e, so that the correct state-specific parser is applied to the pasted text.

#### Acceptance Criteria

1. WHEN the Approval_Form is open, THE Approval_Form SHALL display a State_Selector dropdown showing each available UF as its two-letter code and full state name (e.g., "MG - Minas Gerais")
2. THE State_Selector SHALL dynamically derive its options from the parser registry — only UF values for which a Parser module has been registered will appear, so new states become available automatically as their parsers are added to the codebase
3. THE State_Selector SHALL persist the last selected UF value across modal open/close cycles using the localStorage key "nfce-parser-uf"
4. WHEN no previous selection exists in local storage, THE State_Selector SHALL default to the first available UF in alphabetical order
5. IF the stored UF value in local storage does not match any currently registered Parser, THEN THE State_Selector SHALL fall back to the first available UF in alphabetical order

### Requirement 3: Parse Trigger

**User Story:** As a reviewer, I want to trigger parsing of the pasted NFC-e text, so that the approval form fields are auto-filled.

#### Acceptance Criteria

1. WHEN the Paste_Area contains at least one non-whitespace character and a UF is selected in the State_Selector, THE Approval_Form SHALL display a "Preencher" (Fill) button
2. WHEN the reviewer clicks the "Preencher" button, THE Approval_Form SHALL disable the "Preencher" button and invoke the Parser corresponding to the selected UF with the pasted text as input
3. WHEN the Parser returns a valid Parsed_Result, THE Approval_Form SHALL populate the CNPJ field, establishment name field, issued date field, issued time field, total amount field, and Line_Item list with the extracted values, and re-enable the "Preencher" button
4. WHEN the Parser returns a valid Parsed_Result, THE Approval_Form SHALL replace any previously filled manual data with the parsed values
5. IF the Parser fails to extract data from the pasted text, THEN THE Approval_Form SHALL display an error message indicating parsing failed for the selected UF, preserve any previously entered form data, and re-enable the "Preencher" button

### Requirement 4: Modular State-Specific Parsers

**User Story:** As a developer, I want parsers organized as one module per state, so that new state parsers can be added without modifying existing code.

#### Acceptance Criteria

1. THE Parser system SHALL expose a registry object in an index module (src/lib/parsers/index.ts) that maps each supported UF two-letter code to a Parser function
2. THE Parser system SHALL implement each state Parser as a separate TypeScript module in a dedicated directory (src/lib/parsers/), with each file named by UF code in lowercase (e.g., mg.ts, pe.ts)
3. WHEN a new state Parser module is added to the parsers directory and its UF key is added to the registry object, THE Parser system SHALL make the new UF available in the State_Selector without changes to other Parser modules or UI components
4. THE Parser function interface SHALL accept a raw text string as its single parameter and return either a successful Parsed_Result object or an object containing an error message string

### Requirement 5: Minas Gerais (MG) Parser

**User Story:** As a reviewer, I want the system to parse NFC-e text from Minas Gerais, so that I can auto-fill approval forms for MG receipts.

#### Acceptance Criteria

1. WHEN raw NFC-e text from Minas Gerais is provided, THE MG_Parser SHALL extract the CNPJ by capturing only the digit characters (0-9) appearing after the "CNPJ:" prefix, producing a string of exactly 14 digits
2. WHEN raw NFC-e text from Minas Gerais is provided, THE MG_Parser SHALL extract the establishment name from the text between the "Nota Fiscal de Consumidor Eletrônica (NFC-e)" header and the "CNPJ:" prefix, trimming leading and trailing whitespace
3. WHEN raw NFC-e text from Minas Gerais is provided, THE MG_Parser SHALL extract the issued date and time from the "Data Emissão" section, parsing the DD/MM/YYYY HH:MM:SS input format and outputting issuedDate as YYYY-MM-DD and issuedTime as HH:mm
4. WHEN raw NFC-e text from Minas Gerais is provided, THE MG_Parser SHALL extract each Line_Item by identifying the description text preceding a "(Código: XXX)" pattern, the quantity from the value after "Qtde total de ítens:", the unit from the value after "UN:", and the totalItemValue from the numeric value after "Valor total R$: R$", converting Brazilian decimal format (comma) to dot notation
5. WHEN raw NFC-e text from Minas Gerais is provided, THE MG_Parser SHALL compute each Line_Item unitValue by dividing the totalItemValue by the quantity, rounding to 2 decimal places
6. WHEN raw NFC-e text from Minas Gerais is provided, THE MG_Parser SHALL compute the totalAmount as the sum of all extracted Line_Item totalItemValue fields, rounded to 2 decimal places
7. THE MG_Parser SHALL return a Parsed_Result containing cnpj, establishmentName, issuedDate, issuedTime, totalAmount, and items array where totalAmount equals the sum of all Line_Item totalItemValue fields
8. IF the provided text does not contain both the "CNPJ:" prefix and at least one "(Código:" pattern, THEN THE MG_Parser SHALL return an error indicating the text could not be parsed as an MG NFC-e

### Requirement 6: Pernambuco (PE) Parser

**User Story:** As a reviewer, I want the system to parse NFC-e text from Pernambuco, so that I can auto-fill approval forms for PE receipts.

#### Acceptance Criteria

1. WHEN raw NFC-e text from Pernambuco is provided, THE PE_Parser SHALL extract the CNPJ value appearing after the "CNPJ:" prefix, stripping all non-digit characters (dots, slashes, hyphens) and storing only the 14-digit numeric string
2. WHEN raw NFC-e text from Pernambuco is provided, THE PE_Parser SHALL extract the establishment name from all text preceding the first "CNPJ:" occurrence, trimming leading and trailing whitespace and removing any "DOCUMENTO AUXILIAR" header prefix if present
3. WHEN raw NFC-e text from Pernambuco is provided, THE PE_Parser SHALL extract the issued date and time from the "Data de Emissão:" field, parsing the DD/MM/YYYY HH:MM:SS input format and outputting issuedDate as YYYY-MM-DD and issuedTime as HH:mm
4. WHEN raw NFC-e text from Pernambuco is provided, THE PE_Parser SHALL extract each Line_Item by identifying the description text preceding a "(Código: XXX)" pattern, the quantity from "Qtde.:" (using comma as decimal separator), the unit from "UN:", the unitValue from "Vl. Unit.:" (using comma as decimal separator), and the totalItemValue from "Vl. Total" (using comma as decimal separator)
5. WHEN raw NFC-e text from Pernambuco is provided, THE PE_Parser SHALL compute the totalAmount as the sum of all extracted Line_Item totalItemValue fields, rounded to 2 decimal places
6. THE PE_Parser SHALL return a Parsed_Result containing cnpj, establishmentName, issuedDate, issuedTime, totalAmount, and items array where totalAmount equals the sum of all Line_Item totalItemValue fields
7. IF the provided text does not contain both the "CNPJ:" prefix and at least one "(Código:" pattern, THEN THE PE_Parser SHALL return an error indicating the text could not be parsed as a PE NFC-e

### Requirement 7: Parsed Result Structure

**User Story:** As a developer, I want a well-defined Parsed_Result structure, so that all parsers return consistent data and the form can be populated uniformly.

#### Acceptance Criteria

1. THE Parsed_Result SHALL contain the following fields: cnpj (string, exactly 14 digits), establishmentName (string), issuedDate (string in YYYY-MM-DD format), issuedTime (string in HH:mm format), items (array of Line_Item objects with at least 1 element), and totalAmount (number in reais with 2 decimal places precision)
2. THE Line_Item object SHALL contain the following fields: description (string), quantity (number, positive), unitValue (number in reais with 2 decimal places), and totalItemValue (number in reais with 2 decimal places)
3. IF the Parser cannot extract a required field (cnpj or items), THEN THE Parser SHALL return an error object with a message string indicating which fields could not be extracted
4. FOR ALL valid Parsed_Result objects, THE totalAmount field SHALL equal the sum of all Line_Item totalItemValue fields, rounded to 2 decimal places

### Requirement 8: Editable Parsed Results

**User Story:** As a reviewer, I want to edit any auto-filled values after parsing, so that I can correct parsing errors before confirming approval.

#### Acceptance Criteria

1. WHEN the Approval_Form is populated with parsed data, THE Approval_Form SHALL keep all fields editable (CNPJ, establishment name, issued date, issued time, and each Line_Item's description, quantity, unitValue, and totalItemValue)
2. WHEN the reviewer modifies a parsed field value, THE Approval_Form SHALL include the modified value in the approval submission payload instead of the originally parsed value
3. WHEN the Approval_Form is populated with parsed data, THE Approval_Form SHALL allow adding new Line_Items via the add-item control and removing existing Line_Items via the per-item remove control
4. WHEN the reviewer modifies any Line_Item's totalItemValue field, THE Approval_Form SHALL recalculate and display the updated total amount as the sum of all Line_Item totalItemValue fields
5. IF the reviewer removes all Line_Items, THEN THE Approval_Form SHALL retain one empty Line_Item entry to ensure at least one Line_Item is always present in the list

### Requirement 9: Parser Error Handling

**User Story:** As a reviewer, I want clear feedback when parsing fails, so that I know the text could not be processed and can fill the form manually.

#### Acceptance Criteria

1. IF the pasted text is empty or contains only whitespace and the reviewer clicks "Preencher", THEN THE Approval_Form SHALL display a message "Cole o texto da NFC-e antes de preencher" near the Paste_Area
2. IF the Parser cannot find a CNPJ in the pasted text, THEN THE Parser SHALL return an error with message indicating the CNPJ was not found in the text
3. IF the Parser cannot find any Line_Items in the pasted text, THEN THE Parser SHALL return an error with message indicating no items were found in the text
4. WHEN a parsing error occurs, THE Approval_Form SHALL display the error message near the Paste_Area in red text and preserve any previously entered manual data without clearing the form fields
5. WHEN a parsing error is displayed, THE Approval_Form SHALL retain the pasted text in the Paste_Area so the reviewer can correct the UF selection or text and retry

### Requirement 10: CNPJ Format Normalization

**User Story:** As a developer, I want CNPJ values normalized to digits-only format, so that parsed values are consistent regardless of source formatting.

#### Acceptance Criteria

1. WHEN the Parser extracts a CNPJ with punctuation (dots, slashes, hyphens, spaces), THE Parser SHALL strip all non-digit characters and return only the numeric string, preserving leading zeros
2. IF the extracted CNPJ does not contain exactly 14 digits after normalization, THEN THE Parser SHALL return an error indicating an invalid CNPJ was found
3. THE Parser SHALL perform only digit-count validation (exactly 14 digits) during normalization and SHALL NOT perform check-digit (módulo 11) verification
