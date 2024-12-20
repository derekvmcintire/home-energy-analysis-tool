import React from 'react'
import { TooltipProps, TooltipItem } from 'recharts'

type HeatLoadGraphToolTipProps = {
	payload: TooltipItem[]
}

/**
 * CustomTooltip renders a tooltip for the heat load chart.
 * @param {object} props - The props containing data for the tooltip.
 * @returns {JSX.Element} - The rendered tooltip element.
 */
export const HeatLoadGraphToolTip = (
	props: HeatLoadGraphToolTipProps,
): JSX.Element => {
	const { payload } = props
	const temperature = payload ? payload[0]?.payload?.temperature : null
	const value = payload ? payload[0]?.value : null
	const name = payload && payload[0] ? payload[0].name : ''

	if (temperature !== null) {
		return (
			<div className="tooltip-content rounded border border-gray-300 bg-white p-2">
				<div>{`${Number(value).toLocaleString()} BTU/h`}</div>
				<div>{`${temperature}°F ${name?.replace('Line', ' Heat Load').replace('Point', ' at Design Temperature')}`}</div>
			</div>
		)
	}

	return (
		<div className="tooltip-content rounded border border-gray-300 bg-white p-2">
			<div>{`${Number(value).toLocaleString()} BTU/h`}</div>
			<div>
				{name
					?.replace('Line', ' Heat Load')
					.replace('Point', ' at Design Temperature')}
			</div>
		</div>
	)
}
