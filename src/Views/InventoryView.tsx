import React from 'react'
import '../css/Inventory.css'
import Inventory from '../Game/Inventory'

interface IInventoryProps {
    inventory: Inventory
}

const InventoryView = (props: IInventoryProps): JSX.Element => {
    return (
        <div className="row no-gutters">
            {props.inventory.getItemStackList().map((itemStack, i) => {
                return <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-1" key={i}>
                    <div className="row no-gutters item">
                        <div className="col-7 text-right">
                            <span className="item-name">{itemStack.item.name}:</span>
                        </div>
                        <div className="col-5 text-left">
                            <span>{itemStack.quantity.toFixed(1)}</span>
                        </div>
                        <div className="col-12">
                        </div>
                    </div>
                </div>
            })}
        </div>
    )
}

export default InventoryView
