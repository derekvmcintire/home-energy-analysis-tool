/** THE BELOW PROBABLY NEEDS TO MOVE TO A ROUTE RATHER THAN A COMPONENT, including action function, */
// import { redirect } from '@remix-run/react'
import { type SubmissionResult, useForm } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { json, type ActionFunctionArgs } from '@remix-run/node'
import { Form, redirect, useActionData, useLocation } from '@remix-run/react'
import { parseMultipartFormData } from '@remix-run/server-runtime/dist/formData.js'
import { createMemoryUploadHandler } from '@remix-run/server-runtime/dist/upload/memoryUploadHandler.js'
import { type z } from 'zod'
import { Button } from '#/app/components/ui/button.tsx'
import { ErrorList } from '#app/components/ui/heat/CaseSummaryComponents/ErrorList.tsx'
import GeocodeUtil from '#app/utils/GeocodeUtil.ts'
import { 
    executeGetAnalyticsFromFormJs, 
    executeParseGasBillPy, 
    executeRoundtripAnalyticsFromFormJs 
} from '#app/utils/rules-engine.ts'
import WeatherUtil from '#app/utils/WeatherUtil.ts'



// TODO NEXT WEEK
// - [x] Server side error checking/handling
// - [x] ~Save to cookie and redirect to next form~ Put everything on the same page
// - [x] - Get zod and Typescript to play nice
// - [x] (We're here) Build form #2
// - [ ] Build upload form
//   - [x] https://www.epicweb.dev/workshops/professional-web-forms/file-upload/intro-to-file-upload
//   - [x] https://github.com/epicweb-dev/web-forms/tree/main/exercises/04.file-upload
//   - [x] https://github.com/epicweb-dev/web-forms/blob/2c10993e4acffe3dd9ad7b9cb0cdf89ce8d46ecf/exercises/04.file-upload/01.solution.multi-part/app/routes/users%2B/%24username_%2B/notes.%24noteId_.edit.tsx#L58
//   - [x] createMemoryUploadHandler
//   - [x] parseMultipartFormData
//   - [ ] avoid dealing with the server for now
//   - [ ] pass the data to the rules engine/pyodide either in the component or the action (probably the action for validation, etc.)
// - [x] import pyodide into single.tsx and run it with genny
//     - [x] Add to README: don't forget `npm run buildpy` to build rules engine into `public/pyodide-env` if you start a new codingspace or on local.
// - [x] figure out how to set field defaults with Conform to speed up trials (defaultValue prop on input doesn't work) https://conform.guide/api/react/useForm
// - [x] (To reproduce: Fill out and submit form and go back and submit form again) How do we stop the geocoder helper from concatenating everyone's past submitted addresses onto querystring in single.tsx action?
// example: [MSW] Warning: intercepted a request without a matching request handler: GET https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1+Broadway%2C+Cambridge%2C+MA+02142&format=json&benchmark=2020&address=1+Broadway%2C+Cambridge%2C+MA+02142&format=json&benchmark=2020
// - [x] Zod error at these three lines in Genny because the .optional() zod setting (see ./types/index.tsx) is getting lost somehow, refactor as much of genny away as possible: thermostat_set_point: oldSummaryInput.thermostat_set_point, setback_temperature: oldSummaryInput.setback_temperature, setback_hours_per_day: oldSummaryInput.setback_hours_per_day,
// - [skipped] Display Conform's form-wide errors, currently thrown away (if we think of a use case - 2 fields conflicting...)
// - [x] #162: Pass CSV and form data to rules engine
// - [x] #162: Read the 'overall_start_date' => '2020-10-02',  'overall_end_date' => '2022-11-03' from NaturalGasUsageData and pass to weather fetcher (move up)
// - [x] #162: Get Pydantic to accept our 3rd param userAdjustedData aka pyodideResultsFromTextFile in the 2nd python block
// - [x] #162?: Rebase once #228 is merged and incorporate helpers.get_design_temp in python rather than 12, reconsider SchemaWithDesignTemperature,  add parameters from geocoder for new variables.
// - [ ] Validate pyodide data
// - [ ] Only use csv data after any time the user uploads csv. When the user adjusts the table, use the table data instead.
// - [ ] Disable the submit button when inputs or csv file are invalid
// - [x] Use start_date and end_date from rules-engine output of CSV parsing rather than 2 year window.
// - [ ] (use data passing function API from PR#172 from rules engine) to Build table component form
// - [x] Proposition: always set form default values when run in development
// - [ ] Pass modified table back to rules engine for full cycle revalidation
// - [ ] Feature v2: How about a dropdown? census geocoder address form picker component to choose which address from several, if ambigous or bad.
// - [ ] Treat design_temperature distinctly from design_temperature_override, and design_temperature_override should be kept in state like name or address
// - [ ] Will weather service take timestamp instead of timezone date data?

// Ours
import { HomeSchema, LocationSchema, CaseSchema /* validateNaturalGasUsageData, HeatLoadAnalysisZod */ } from '../../../types/index.ts'
import { type NaturalGasUsageDataSchema} from '../../../types/types.ts'
import { CurrentHeatingSystem } from '../../components/ui/heat/CaseSummaryComponents/CurrentHeatingSystem.tsx'
import { EnergyUseHistory } from '../../components/ui/heat/CaseSummaryComponents/EnergyUseHistory.tsx'
import { HomeInformation } from '../../components/ui/heat/CaseSummaryComponents/HomeInformation.tsx'
import HeatLoadAnalysis from './heatloadanalysis.tsx'
import React from 'react'

/** Modeled off the conform example at
 *     https://github.com/epicweb-dev/web-forms/blob/b69e441f5577b91e7df116eba415d4714daacb9d/exercises/03.schema-validation/03.solution.conform-form/app/routes/users%2B/%24username_%2B/notes.%24noteId_.edit.tsx#L48 */

const HomeFormSchema = HomeSchema.pick({ living_area: true })
    .and(LocationSchema.pick({ address: true }))
    .and(CaseSchema.pick({ name: true }))

const CurrentHeatingSystemSchema = HomeSchema.pick({
    fuel_type: true,
    heating_system_efficiency: true,
    design_temperature_override: true,
    thermostat_set_point: true,
    setback_temperature: true,
    setback_hours_per_day: true,
})

const Schema = HomeFormSchema.and(CurrentHeatingSystemSchema) /* .and(HeatLoadAnalysisZod.pick({design_temperature: true})) */

export async function action({ request, params }: ActionFunctionArgs) {
    // Checks if url has a homeId parameter, throws 400 if not there
    // invariantResponse(params.homeId, 'homeId param is required')

    console.log('action started')

    const uploadHandler = createMemoryUploadHandler({
        maxPartSize: 1024 * 1024 * 5, // 5 MB
    })
    const formData = await parseMultipartFormData(request, uploadHandler)

    const file = formData.get('energy_use_upload') as File // fix as File?

    async function handleFile(file: File) {
        try {
            const fileContent = await file.text()
            return fileContent
        } catch (error) {
            console.error('Error reading file:', error)
            return ''
        }
    }

    // TODO: think about the edge cases and handle the bad user input here:
    const uploadedTextFile: string = file !== null ? await handleFile(file) : ''
    
    const submission = parseWithZod(formData, {
        schema: Schema,
    })

    if (submission.status !== 'success') {
        if (process.env.NODE_ENV === 'development') {
            // this can have personal identifying information, so only active in development.
            console.error('submission failed', submission)
        }
        return submission.reply()
        // submission.reply({
        // 	// You can also pass additional error to the `reply` method
        // 	formErrors: ['Submission failed'],
        // 	fieldErrors: {
        // 		address: ['Address is invalid'],
        // 	},

        // 	// or avoid sending the the field value back to client by specifying the field names
        // 	hideFields: ['password'],
        // }),
        // {status: submission.status === "error" ? 400 : 200}
    }

    const {
        name,
        address,
        living_area,
        fuel_type,
        heating_system_efficiency,
        thermostat_set_point,
        setback_temperature,
        setback_hours_per_day,
        design_temperature_override,
    } = submission.value

    // await updateNote({ id: params.noteId, title, content })
    //code snippet from - https://github.com/epicweb-dev/web-forms/blob/2c10993e4acffe3dd9ad7b9cb0cdf89ce8d46ecf/exercises/04.file-upload/01.solution.multi-part/app/routes/users%2B/%24username_%2B/notes.%24noteId_.edit.tsx#L180

    // const formData = await parseMultipartFormData(
    // 	request,
    // 	createMemoryUploadHandler({ maxPartSize: MAX_UPLOAD_SIZE }),
    // )

    console.log('loading geocodeUtil/weatherUtil')

    const geocodeUtil = new GeocodeUtil()
    const weatherUtil = new WeatherUtil()

    let {coordinates, state_id, county_id}  = await geocodeUtil.getLL(address)
    let {x, y} = coordinates ?? {x: 0, y: 0};

    console.log('geocoded', x, y)

    // CSV entrypoint parse_gas_bill(data: str, company: NaturalGasCompany)
    // Main form entrypoint

    type SchemaZodFromFormType = z.infer<typeof Schema>

    const parsedAndValidatedFormSchema: SchemaZodFromFormType = Schema.parse({
        living_area: living_area,
        address,
        name: `${ name }'s home`,
        fuel_type,
        heating_system_efficiency,
        thermostat_set_point,
        setback_temperature,
        setback_hours_per_day,
        design_temperature_override,
        // design_temperature: 12 /* TODO:  see #162 and esp. #123*/
    })

    // console.log('parsedAndValidatedFormSchema', parsedAndValidatedFormSchema)


    // console.log("uploadedTextFile", uploadedTextFile)


    /** Example:
     * records: [
     *   Map(4) {
     *     'period_start_date' => '2022-10-04',
     *     'period_end_date' => '2022-11-03',
     *     'usage_therms' => 19,
     *     'inclusion_override' => undefined
     *   }
     * ],
     * 'overall_start_date' => '2020-10-02',
     * 'overall_end_date' => '2022-11-03'
     */
    // This assignment of the same name is a special thing. We don't remember the name right now.
    // It's not necessary, but it is possible.
    const pyodideResultsFromTextFile: NaturalGasUsageDataSchema = executeParseGasBillPy(uploadedTextFile).toJs()

    // console.log('result', pyodideResultsFromTextFile )//, validateNaturalGasUsageData(pyodideResultsFromTextFile))
    const startDateString = pyodideResultsFromTextFile.get('overall_start_date');
    const endDateString = pyodideResultsFromTextFile.get('overall_end_date');
    
    if (typeof startDateString !== 'string' || typeof endDateString !== 'string') {
        throw new Error('Start date or end date is missing or invalid');
    }
    
    // Get today's date
    const today = new Date();
    // Calculate the date 2 years ago from today
    const twoYearsAgo = new Date(today);
    twoYearsAgo.setFullYear(today.getFullYear() - 2);
    
    let start_date = new Date(startDateString);
    let end_date = new Date(endDateString);
    
    // Use default dates if parsing fails
    if (isNaN(start_date.getTime())) {
        console.warn('Invalid start date, using date from 2 years ago');
        start_date = twoYearsAgo;
    }
    if (isNaN(end_date.getTime())) {
        console.warn('Invalid end date, using today\'s date');
        end_date = today;
    }
    
    // Function to ensure we always return a valid date string
    const formatDateString = (date: Date): string => {
        return date.toISOString().split('T')[0] || date.toISOString().slice(0, 10);
    };
    
    const weatherData = await weatherUtil.getThatWeathaData(
        x,
        y,
        formatDateString(start_date),
        formatDateString(end_date)
    );

    const datesFromTIWD = weatherData.dates.map(datestring => new Date(datestring).toISOString().split('T')[0])
    const convertedDatesTIWD = {dates: datesFromTIWD, temperatures: weatherData.temperatures}

    /** Main form entrypoint
     */

    // type Analytics = z.infer<typeof Analytics>;
    const gasBillDataWithUserAdjustments: any = executeGetAnalyticsFromFormJs(parsedAndValidatedFormSchema, convertedDatesTIWD, uploadedTextFile, state_id, county_id).toJs()

    //console.log("gasBillDataWithUserAdjustments billing records [0]", gasBillDataWithUserAdjustments.get('processed_energy_bills')[0] )

    /**
     * second time and after, when table is modified, this becomes entrypoint
     */


    /**
     * Ask Alan, issue with list comprehension:
Traceback (most recent call last): File "<exec>", line 32,
 in executeRoundtripAnalyticsFromForm TypeError: 
 list indices must be integers or slices, not str 
     */
    /*
    For
      'processed_energy_bills' => [
    Map(9) {
      'period_start_date' => '2020-10-02',
      'period_end_date' => '2020-11-04',
      'usage' => 29,
      'analysis_type_override' => undefined,
      'inclusion_override' => false,
      'analysis_type' => 0,
      'default_inclusion' => false,
      'eliminated_as_outlier' => false,
      'whole_home_heat_loss_rate' => undefined
    }, */


    // const billingRecords = gasBillDataWithUserAdjustments.get('processed_energy_bills')
    // billingRecords.forEach((record: any) => {
    //     record.set('inclusion_override', true);
    // });
    // gasBillDataWithUserAdjustments.set('processed_energy_bills', null)
    // gasBillDataWithUserAdjustments.set('processed_energy_bills', billingRecords)
    //console.log("(after customization) gasBillDataWithUserAdjustments billing records[0]", gasBillDataWithUserAdjustments.get('processed_energy_bills')[0])
    /* why is inclusion_override still false after roundtrip */
    const calculatedData: any = executeRoundtripAnalyticsFromFormJs(parsedAndValidatedFormSchema, convertedDatesTIWD, gasBillDataWithUserAdjustments, state_id, county_id).toJs()

    // console.log("calculatedData billing records[0]", calculatedData.get('processed_energy_bills')[0]);
    // console.log("calculatedData", calculatedData);
    // console.log("(after round trip) gasBillDataWithUserAdjustments billing records[0]", gasBillDataWithUserAdjustments.get('processed_energy_bills')[0])

    // const otherResult = executePy(summaryInput, convertedDatesTIWD, exampleNationalGridCSV);

    const str_version = JSON.stringify(calculatedData, replacer);
    // const json_version = JSON.parse(str_version);
    // console.log("str_version", str_version);

    // Consider adding to form data
    return json({data: str_version});
    // return redirect(`/single`)
}

/** Pass this to JSON.stringify()
 * 
 * Usage:
 * const originalValue = new Map([['a', 1]]);
 * const str = JSON.stringify(originalValue, replacer);
 * 
 * See https://stackoverflow.com/a/56150320
 */
function replacer(key: any, value: any) {
    if(value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}
    
/** Pass this to JSON.parse()
 * 
 * Usage:
 * const originalValue = new Map([['a', 1]]);
 * const str = JSON.stringify(originalValue, replacer);
 * const newValue = JSON.parse(str, reviver);
 * 
 * See https://stackoverflow.com/a/56150320
 */
function reviver(key: any, value: any) {
    if(typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
            return new Map(value.value);
        }
    }
    return value;
}

/**
 * Translates an already replaced (see https://stackoverflow.com/a/56150320) and then parsed Map from pyodide into a plain js Object.
 * @param input {Map} 
 * @returns {Object}
 */
function replacedMapToObject(input: any): any {
	// Base case: if input is not an object or is null, return it as-is
	if (typeof input !== 'object' || input === null) {
		return input
	}

	// Handle case where input is a Map-like object (with "dataType" as "Map" and a "value" array)
	if (input.dataType === 'Map' && Array.isArray(input.value)) {
		const obj: Record<any, any> = {} // Initialize an empty object
		for (const [key, value] of input.value) {
			obj[key] = replacedMapToObject(value) // Recursively process nested Maps
		}
		return obj
	}

	// Handle case where input is an array
	if (Array.isArray(input)) {
		return input.map(replacedMapToObject) // Recursively process each array element
	}

	console.log('input', input)
	// Return the input for any other types of objects
	return input
}


export default function Inputs() {
    // const location = useLocation();
    // console.log(`location:`, location);  // `.state` is `null`
    const lastResult = useActionData<typeof action>()
    console.log('lastResult', lastResult)

    let show_usage_data = lastResult !== undefined;

    ////////////////////////
    // TODO: 
    // - use the UsageDataSchema type here?
    // - use processed_energy_bills in Checkbox behavior
    // 
    let currentUsageData = {
        heat_load_output: undefined,
        balance_point_graph: undefined,
        processed_energy_bills: undefined,
    }

    if (show_usage_data && hasDataProperty(lastResult)) {
        try {
            // Parse the JSON string from lastResult.data
            const parsedLastResult = JSON.parse(lastResult.data, reviver) as Map<any, any>;
            console.log('parsedLastResult', parsedLastResult)

            // TODO: Parsing without reviver to get processed_energy_bills with Objects instead of maps
            // Figure out how to use parsedLastResult instead
            const parsedLastResultObject = JSON.parse(lastResult.data)

            currentUsageData.heat_load_output = Object.fromEntries(parsedLastResult?.get('heat_load_output'));
            currentUsageData.balance_point_graph = Object.fromEntries(parsedLastResult?.get('balance_point_graph'));

            currentUsageData.processed_energy_bills = replacedMapToObject(parsedLastResultObject).processed_energy_bills

        } catch (error) {
            // console.error('Error parsing lastResult data:', error);
        }
    }

    console.log('currentUsageData', currentUsageData)
   


    /* @ts-ignore */
    // console.log("lastResult (all Rules Engine data)", lastResult !== undefined ? JSON.parse(lastResult.data, reviver): undefined)

    /**
     * Where temp1 is a temporary variable with the main Map of Maps (or undefined if page not yet submitted).
     *
     * temp1.get('heat_load_output'): Map(9) { estimated_balance_point → 61.5, other_fuel_usage → 0.2857142857142857, average_indoor_temperature → 67, difference_between_ti_and_tbp → 5.5, design_temperature → 1, whole_home_heat_loss_rate → 48001.81184312083, standard_deviation_of_heat_loss_rate → 0.08066745182677547, average_heat_load → 3048115.0520381727, maximum_heat_load → 3312125.0171753373 }
     */
    /* @ts-ignore */
    // console.log("Summary Output", lastResult !== undefined ? JSON.parse(lastResult.data, reviver)?.get('heat_load_output'): undefined)
    
    /**
     * Where temp1 is a temporary variable with the main Map of Maps (or undefined if page not yet submitted).
     * temp1.get('processed_energy_bills')
     * Array(25) [ Map(9), Map(9), Map(9), Map(9), Map(9), Map(9), Map(9), Map(9), Map(9), Map(9), … ]
     * temp1.get('processed_energy_bills')[0]
     * Map(9) { period_start_date → "2020-10-02", period_end_date → "2020-11-04", usage → 29, analysis_type_override → null, inclusion_override → true, analysis_type → 0, default_inclusion → false, eliminated_as_outlier → false, whole_home_heat_loss_rate → null }
     * temp1.get('processed_energy_bills')[0].get('period_start_date')
    * "2020-10-02" 
     */
    /* @ts-ignore */
    // console.log("EnergyUseHistoryChart table data", lastResult !== undefined ? JSON.parse(lastResult.data, reviver)?.get('processed_energy_bills'): undefined)

    /**
     * Where temp1 is a temporary variable with the main Map of Maps (or undefined if page not yet submitted).
     *  temp1.get('balance_point_graph').get('records')
        Array(23) [ Map(5), Map(5), Map(5), Map(5), Map(5), Map(5), Map(5), Map(5), Map(5), Map(5), … ]
        temp1.get('balance_point_graph').get('records')[0]
        Map(5) { balance_point → 60, heat_loss_rate → 51056.8007761249, change_in_heat_loss_rate → 0, percent_change_in_heat_loss_rate → 0, standard_deviation → 0.17628334816871494 }
        temp1.get('balance_point_graph').get('records')[0].get('heat_loss_rate') 
     *//* @ts-ignore */
     
    // console.log("HeatLoad chart", lastResult !== undefined ? JSON.parse(lastResult.data, reviver)?.get('balance_point_graph')?.get('records'): undefined) 
    type ActionResult = 
    | SubmissionResult<string[]>
    | { data: string }
    | undefined;
  
    /** typeguard for useAction between string[] and {data: string} */
    function hasDataProperty(result: ActionResult): result is { data: string } {
        return result !== undefined && 'data' in result && typeof (result as any).data === 'string';
    }  

    ////////////////////////
    // TO BE DELETED
    // Old way of handing results

    // let usage_data = null;
    
    // // Ensure we handle the result properly
    // if (show_usage_data && lastResult && hasDataProperty(lastResult)) {
    //     try {
    //         // Parse the JSON string from lastResult.data
    //         const parsedData = JSON.parse(lastResult.data);

    //         // Recursively transform any Maps in lastResult to objects
    //         usage_data = replacedMapToObject(parsedData); // Get the relevant part of the transformed result
    //         console.log('usage_data', usage_data)
            
    //     } catch (error) {
    //         console.error('Error parsing lastResult data:', error);
    //     }
    // }
    ////////////////////////

    type SchemaZodFromFormType = z.infer<typeof Schema>
    const [form, fields] = useForm({
        /* removed lastResult , consider re-adding https://conform.guide/api/react/useForm#options */
        onValidate({ formData }) {
            return parseWithZod(formData, { schema: Schema })
        },
        defaultValue: {
            living_area: 2155,
            address: '15 Dale Ave Gloucester, MA  01930',
            name: 'CIC',
            fuel_type: 'GAS',
            heating_system_efficiency: 0.97,
            thermostat_set_point: 68,
            // setback_temperature: 65,
            // setback_hours_per_day: 8,
            // design_temperature_override: '',
        } as SchemaZodFromFormType,
        shouldValidate: 'onBlur',
    })

    return (
        <>
        <pre>{JSON.stringify(lastResult, null, 2)}</pre>
            <Form
                id={form.id}
                method="post"
                onSubmit={form.onSubmit}
                action="/single"
                encType="multipart/form-data"
            >
                {' '}
                {/* https://github.com/edmundhung/conform/discussions/547 instructions on how to properly set default values
            This will make it work when JavaScript is turned off as well 
            <Input {...getInputProps(props.fields.address, { type: "text" })} /> */}
                <HomeInformation fields={fields} />
                <CurrentHeatingSystem fields={fields} />
                <EnergyUseHistory usage_data={ currentUsageData } />
                <ErrorList id={form.errorId} errors={form.errors} />
                <Button type="submit">Submit</Button>
            </Form>
            {show_usage_data && <HeatLoadAnalysis heatLoadSummaryOutput={currentUsageData.heat_load_output} /> }
        </>
    )
}
